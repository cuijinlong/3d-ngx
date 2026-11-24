import { Button, Form, Input, Modal, Select, Space, Typography, Upload, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UploadFile } from "antd/es/upload/interface";
import {
  STYLE_PACK_FALLBACK,
  getGuardStatus,
  getProviderKind,
  getSceneTemplateApi,
  getTopologyApi,
  type SceneTemplateCard,
  type TopologyStylePack,
} from "@idt/data-adapter";
import { useAuthSession } from "../../auth/AuthSession";
import { brandPath } from "../../auth/access";
import { routes } from "../../constants/routes";
import { EntryChrome, entryStyles as styles } from "../entry/EntryChrome";
import { TemplateFileExplorer } from "../../features/scene-editor/TemplateFileExplorer";

const MAX_BYTES = 48 * 1024 * 1024;

interface TemplateFormValues {
  name: string;
  description?: string;
  templateVersion?: string;
  stylePack?: string;
}

/**
 * 模板库（仅租户）。
 *
 * <h2>为什么要有这个页面</h2>
 *
 * 平台侧 `/api/energy/scene-templates` 早就实现了（列表/新建/改/删/上传/下载），
 * 但 3d-ngx 前端**一行都没调用过** —— 之前所有场景都是我写脚本建的，
 * 租户自己在界面上建不了场景模板。这个页面补的就是这个缺口。
 *
 * <h2>「上传模型」是两步，不是一步</h2>
 *
 * 后端把「传文件」和「记档案」分开了：
 *   POST /scene-template-assets 只写对象存储，**不写模板档案**
 *   档案里的 glb 必须由 create/update 的 glb 字段提交
 * 所以这里的保存顺序固定为：先 create 拿 id → 再 upload（带 templateId，
 * 直接落到正式目录而不是 inbox）→ 再 update 写档案。
 * 顺序反了会得到一个「有文件但档案里没模型」的模板，界面上显示「未上传模型」。
 */
export function TemplatesPage() {
  const { role, customerId } = useAuthSession();
  const nav = useNavigate();
  const [rows, setRows] = useState<SceneTemplateCard[]>([]);
  const [packs, setPacks] = useState<TopologyStylePack[]>(STYLE_PACK_FALLBACK.packs);
  const [packsFallback, setPacksFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SceneTemplateCard | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 文件资源管理器（2026-11-24）。
   *
   * <p>存整张卡片而不只是 id：弹框标题要显示模板名，且打开时要判断
   * 「有没有模型」给出不同提示。只存 id 的话得到处再查一遍。
   */
  const [filesOf, setFilesOf] = useState<SceneTemplateCard | null>(null);
  const [form] = Form.useForm<TemplateFormValues>();

  /*
   * 用 provider 状态判断，不用 try/catch 试调 API：
   * 后者塞在 useMemo([]) 里只算一次，若 provider 初始化晚于首次渲染
   * （登出后重登、或直接刷新进本页），会永久误判成「未连接」。
   */
  const connected = getProviderKind() === "guard" && getGuardStatus().connected;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getSceneTemplateApi().list());
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error && err.message ? err.message : "读取模板库失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      setError("尚未连接后端。模板库需要连接平台后才能使用。");
      return;
    }
    void refresh();
    void getTopologyApi()
      .stylePacks()
      .then((catalog) => {
        setPacks(catalog.packs.length ? catalog.packs : STYLE_PACK_FALLBACK.packs);
        setPacksFallback(Boolean(catalog.usedFallback));
      })
      .catch(() => setPacksFallback(true));
  }, [connected, refresh]);

  const openCreate = () => {
    setEditing(null);
    setFile(null);
    form.resetFields();
    form.setFieldsValue({ templateVersion: "1.0.0", stylePack: packs[0]?.stylePack });
    setEditorOpen(true);
  };

  const openEdit = (row: SceneTemplateCard) => {
    setEditing(row);
    setFile(null);
    form.setFieldsValue({
      name: row.name,
      description: row.description,
      templateVersion: row.templateVersion,
      stylePack: row.stylePack,
    });
    setEditorOpen(true);
  };

  const takeFile = (next: File): boolean => {
    if (!next.name.toLowerCase().endsWith(".glb")) {
      message.error("模板模型必须是 .glb 文件");
      return false;
    }
    if (next.size > MAX_BYTES) {
      message.error("文件不能超过 48MB");
      return false;
    }
    return true;
  };

  const submit = async () => {
    const values = await form.validateFields();
    setBusy(true);
    try {
      const api = getSceneTemplateApi();
      const [packId, packVersion] = (values.stylePack || "").includes("@")
        ? (values.stylePack!.split("@") as [string, string])
        : [values.stylePack || "", "1.0.0"];

      let templateId: string;
      if (editing) {
        templateId = editing.id;
        await api.update(templateId, {
          name: values.name.trim(),
          description: values.description || "",
          templateVersion: values.templateVersion,
          ...(values.stylePack ? { stylePack: values.stylePack, packId, packVersion } : {}),
        });
      } else {
        const created = await api.create({
          name: values.name.trim(),
          description: values.description || "",
          templateVersion: values.templateVersion,
          ...(values.stylePack ? { stylePack: values.stylePack, packId, packVersion } : {}),
        });
        templateId = created.id;
      }

      /*
       * 第二步：模型。带 templateId 上传会直接写到正式目录
       * （scene-template/{tenant}/{id}/model.glb），不是 inbox，
       * 因此不需要再「提升」一次；随后 update 把 objectKey 记进档案。
       */
      if (file) {
        const uploaded = await api.uploadAsset(file, { kind: "glb", templateId });
        if (!uploaded?.objectKey) throw new Error("模型上传后没有返回 objectKey");
        await api.update(templateId, {
          glb: { objectKey: uploaded.objectKey, fileName: uploaded.fileName || file.name },
        });
      }

      message.success(editing ? "模板已更新" : "模板已创建");
      setEditorOpen(false);
      setFile(null);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : "保存模板失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: SceneTemplateCard) => {
    Modal.confirm({
      title: `删除模板「${row.name}」？`,
      content: "已有已发布场景引用这个模板时，平台会拒绝删除。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await getSceneTemplateApi().delete(row.id);
          message.success("已删除");
          await refresh();
        } catch (err) {
          message.error(err instanceof Error && err.message ? err.message : "删除失败（可能仍被已发布场景引用）");
        }
      },
    });
  };

  /**
   * 用模板建场景：把模板 id 带进新建向导。
   * 向导会下载模板模型、预填套装，再走正常的「选客户/场站/资产根」流程。
   */
  const createSceneFrom = (row: SceneTemplateCard) => {
    /*
     * 有当前客户就直接进那个客户的场景页（少一步）；
     * 没有就先去选客户 —— 场景必须落在某个客户下，这一步不能省。
     */
    const base = customerId ? routes.customerScenes(customerId) : routes.selectCustomer;
    nav(`${base}?templateId=${encodeURIComponent(row.id)}`);
  };

  return (
    <EntryChrome crumbs={<b>模板库</b>} brandTo={brandPath(role)}>
      <div className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1>模板库</h1>
            <p className={styles.sub}>
              模板保存「模型 + 风格套装」，用它建场景时会自动带过去。大屏布局在新建场景时选，不固定在模板里 ——
              同一个模型可以配不同的大屏版式。
            </p>
          </div>
          <button type="button" className={styles.primary} disabled={!connected} onClick={openCreate}>
            新建模板
          </button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {packsFallback ? (
          <div className={styles.draft}>套装接口不可用，已用内置列表兜底（hvac-hud-v1 / campus-daynight-v1）。</div>
        ) : null}

        <div className={styles.grid}>
          {rows.map((row) => (
            <article key={row.id} className={styles.tile}>
              <div className={styles.thumb}>{row.glbObjectKey ? "已上传模型" : "未上传模型"}</div>
              <div className={styles.titleRow}>
                <h2 className={styles.tileTitle}>{row.name}</h2>
                {row.templateVersion ? <span className={styles.tag}>v{row.templateVersion}</span> : null}
                {!row.glbObjectKey ? <span className={styles.tag}>缺模型</span> : null}
              </div>
              <div className={styles.tileMeta}>
                <span>套装 {row.stylePack || "—"}</span>
                <span>模型 {row.glbObjectKey ? "已绑定" : "未绑定"}</span>
              </div>
              {row.description ? (
                <p className={styles.sub} style={{ margin: "8px 0 0" }}>{row.description}</p>
              ) : null}
              <div className={styles.tileActions}>
                <button type="button" className={styles.link} disabled={!row.glbObjectKey} onClick={() => createSceneFrom(row)}>
                  用它建场景
                </button>
                <button type="button" className={styles.link} onClick={() => openEdit(row)}>
                  编辑
                </button>
                {/*
                 * 文件资源管理器入口（2026-11-24）。
                 *
                 * 不禁用「没有模型的模板」：套装文件（css/js）也算资源，
                 * 有些模板只有套装没有模型。禁用会让人以为这个功能用不了。
                 */}
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => setFilesOf(row)}
                  data-testid="open-template-files"
                  data-template-id={row.id}
                >
                  文件
                </button>
                <button type="button" className={styles.link} onClick={() => void remove(row)}>
                  删除
                </button>
              </div>
            </article>
          ))}
          {!loading && rows.length === 0 && !error ? (
            <div className={styles.emptyPane}>
              还没有模板。新建一个模板并上传 GLB，之后就能一键生成新场景。
            </div>
          ) : null}
          {loading ? <div className={styles.emptyPane}>加载中…</div> : null}
        </div>
      </div>

      <Modal
        title={editing ? "编辑模板" : "新建模板"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              {editing ? "保存" : "创建"}
            </Button>
          </Space>
        }
        width={620}
        centered
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="模板名称" name="name" rules={[{ required: true, message: "请填写模板名称" }]}>
            <Input placeholder="例如：冷热站标准版" maxLength={80} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} placeholder="这个模板适合什么场景" maxLength={200} />
          </Form.Item>
          <Form.Item label="版本" name="templateVersion" rules={[{ required: true, message: "请填写版本" }]}>
            <Input placeholder="1.0.0" maxLength={24} />
          </Form.Item>
          <Form.Item
            label="风格套装"
            name="stylePack"
            extra={packsFallback ? "套装接口不可用，已用内置列表兜底" : "实例化时会沿用到场景 settings"}
          >
            <Select
              allowClear
              placeholder="选择风格套装"
              options={packs.map((item) => ({
                value: item.stylePack,
                label: `${item.label}（${item.stylePack}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={editing?.glbObjectKey ? "替换模型（可选）" : "模型文件"}
            extra={
              editing?.glbObjectKey
                ? "已绑定模型，选择新文件会替换。不选则保持原模型。"
                : "上传 .glb，最大 48MB。先建档案再传文件，两步都要成功才算完成。"
            }
          >
            <Upload
              accept=".glb"
              maxCount={1}
              fileList={file ? ([{ uid: "glb", name: file.name, status: "done" }] as UploadFile[]) : []}
              beforeUpload={(next) => {
                if (takeFile(next)) setFile(next);
                return false;
              }}
              onRemove={() => setFile(null)}
            >
              <Button>选择或拖入 GLB</Button>
            </Upload>
            {file ? (
              <Typography.Text type="secondary">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </Typography.Text>
            ) : null}
          </Form.Item>
        </Form>
      </Modal>

      <TemplateFileExplorer
        open={filesOf != null}
        template={filesOf}
        onClose={() => setFilesOf(null)}
      />
    </EntryChrome>
  );
}
