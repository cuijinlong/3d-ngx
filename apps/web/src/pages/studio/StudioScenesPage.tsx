
import { Button, Card, Empty, Input, Modal, Space, Upload, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateSceneWizard } from "../../features/scene-editor/CreateSceneWizard";
import type { SceneListItem } from "@idt/shared-types";
import { routes } from "../../constants/routes";
import {
  deleteScene,
  duplicateScene,
  importSceneJson,
  listScenes,
  openSceneKey,
  validateSceneJson,
} from "../../services/scene/sceneService";
import { readJsonFile } from "../../utils/download";

export function StudioScenesPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<SceneListItem[]>([]);
  const [name, setName] = useState("新建工业场景");
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = () => void listScenes().then(setRows);
  useEffect(() => {
    refresh();
  }, []);

  const create = () => setWizardOpen(true);

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">场景工作室</h1>
            <p className="page-sub">创建、复制、导入导出场景。大型模型保存在浏览器 IndexedDB。</p>
          </div>
          <Space>
            <Input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
            <Button type="primary" onClick={() => create()}>新建场景</Button>
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={async (file) => {
                try {
                  const data = await readJsonFile(file);
                  const result = validateSceneJson(data);
                  if (!result.success) {
                    message.error("场景 JSON 校验失败，请确认 schemaVersion 为 1.0.0");
                    return false;
                  }
                  const doc = await importSceneJson(data);
                  message.success("已导入场景");
                  nav(routes.studioEditor(openSceneKey(doc) || doc.scene.id));
                } catch (error) {
                  message.error(error instanceof Error ? error.message : "导入失败");
                }
                return false;
              }}
            >
              <Button>导入 JSON</Button>
            </Upload>
          </Space>
        </div>
        {rows.length === 0 ? (
          <Empty description="暂无场景" />
        ) : (
          <div className="card-grid">
            {rows.map((s) => (
              <Card
                key={s.id}
                title={s.name}
                extra={s.publishedAt ? "已发布" : "草稿"}
                actions={[
                  <Button type="link" key="edit" onClick={() => nav(routes.studioEditor(s.topologyId || s.id))}>编辑</Button>,
                  <Button type="link" key="copy" onClick={() => void duplicateScene(s.id).then(refresh)}>复制</Button>,
                  <Button
                    type="link"
                    danger
                    key="del"
                    onClick={() => {
                      Modal.confirm({
                        title: "删除场景？",
                        onOk: () => deleteScene(s.id).then(refresh),
                      });
                    }}
                  >
                    删除
                  </Button>,
                ]}
              >
                <div style={{ color: "var(--idt-muted)", fontSize: 12 }}>
                  {s.hasRootModel ? "已导入模型" : "未导入模型"} · 实体 {s.entityCount}
                  <div>更新 {s.updatedAt.slice(0, 19).replace("T", " ")}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
        <CreateSceneWizard
          open={wizardOpen}
          defaultName={name}
          onCancel={() => setWizardOpen(false)}
          onCreated={(doc) => {
            setWizardOpen(false);
            refresh();
            nav(routes.studioEditor(openSceneKey(doc) || doc.scene.id));
          }}
        />
      </div>
    </div>
  );
}
