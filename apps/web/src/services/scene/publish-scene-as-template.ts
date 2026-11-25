import type { SceneDocument } from "@idt/shared-types";
import { buildRequirementsSkeleton } from "../../features/scene-editor/requirements-skeleton";
import {
  getConnectedGuardClient,
  getSceneTemplateApi,
  getTopologyApi,
  type SceneTemplateCard,
} from "@idt/data-adapter";

/**
 * 把当前场景发布成一套可复用的场景模板（2026-11-23）。
 *
 * <h2>为什么单独一个文件</h2>
 *
 * <p>顶栏的「发布为模板」原来只调 `publish()` —— 那是**把场景发布**
 * （`publishState = published`），**一条模板档案都没建**。
 * 按钮名说「发布为模板」，行为是「发布场景」，用户点完去模板中心找，
 * 什么都没有，也不会报错。
 *
 * <p>这个文件把它做对，并集中解释「模板到底能带走什么」。
 *
 * <h2>★ 模板能带走的只有三样</h2>
 *
 * <p>后端的模板档案（`additionalInfo`）白名单只有：
 * `templateVersion` / `description` / `glb` / `styleFiles` / `packId` / `packVersion`。
 * **没有布局字段**（实测：新建实例的 `scene-widgets` 是 `{"widgets":[]}`）。
 *
 * <p>所以这套流程产出的是「模型 + 风格套装」的模板。大屏骨架要靠
 * 「模板 → 内置布局」的映射，槽位绑定要在实例层逐项填。
 * 把这条写进返回值，让调用方如实告知用户，而不是说「发布成功」就完事 ——
 * 用户会以为布局也跟着存进去了。
 */
export interface PublishTemplateResult {
  /** 新建的模板档案 */
  template: SceneTemplateCard;
  /** 模型是否真的传上去了 */
  modelUploaded: boolean;
  /** 给用户看的说明（含「布局不会进模板」这条） */
  note: string;
}

const MAX_BYTES = 48 * 1024 * 1024;

export async function publishSceneAsTemplate(
  document: SceneDocument,
  options: { name?: string; description?: string; version?: string } = {},
): Promise<PublishTemplateResult> {
  const client = getConnectedGuardClient();
  if (!client) throw new Error("未连接平台，无法发布模板");

  const sceneName = document.scene.name?.trim() || "未命名场景";
  const platform = document.platform;
  const stylePack = platform?.stylePack;

  const api = getSceneTemplateApi();
  const template = await api.create({
    name: options.name?.trim() || sceneName,
    description: options.description?.trim()
      /* 场景本身没有 description 字段（ScenePlatformRef 里没有），
         用「来源场景 + 站点」拼一句，比空着有用 —— 模板列表里空描述
         会让人以为是没建完。 */
      || `${sceneName}（由场景发布${platform?.siteName ? ` · ${platform.siteName}` : ""}）`,
    templateVersion: options.version || "1.0.0",
    ...(stylePack ? { stylePack } : {}),
  });

  /*
   * 模型必须「下载再上传」，不能直接把场景的 objectKey 挂给模板。
   *
   * <p>平台对 key 前缀有约束：场景模型在 `topology/{tenant}/` 下，
   * 模板模型在 `scene-template/{tenant}/` 下，`bindTemplateKey` 会拒绝跨前缀的 key。
   * 所以这里把 GLB 取回来再作为新文件上传 —— 与「从模板建场景」是反向的同一件事。
   */
  const objectKey = platform?.glb?.objectKey;
  let modelUploaded = false;
  let modelNote = "";
  if (!objectKey) {
    modelNote = "这个场景没有模型，模板只包含风格套装。";
  } else {
    try {
      const bytes = await client.requestBytes(getTopologyApi().assetUrl(objectKey));
      const buffer = await bytes.blob.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) {
        modelNote = `场景模型 ${Math.round(buffer.byteLength / 1024 / 1024)}MB 超过 48MB 上限，模板只包含风格套装。`;
      } else {
        /*
         * ★ 文件名用**场景名**拼，不用 `platform.glb.fileName`（2026-11-24 修）。
         *
         * <h3>为什么不能沿用场景档案里的名字</h3>
         *
         * <p>那个字段在旧版本里被后端 `safeFileName` 压平过 —— 实测
         * 「天骄科技园」场景的 `glb.fileName` 存的是 `_____.glb`
         * （正则 `[^A-Za-z0-9._-]` 把中文全换成下划线）。沿用它，
         * 一模一样地把坏名字传进新模板，而**编译期与运行期都不会报错**。
         *
         * <p>用场景名重新拼：一来名字有意义（用户认得出），
         * 二来不依赖历史脏数据。扩展名固定 `.glb` —— 已校验过是 GLB。
         */
        const sceneName = document.scene.name?.trim() || "场景模型";
        const fileName = `${sceneName}.glb`;
        const file = new File([buffer], fileName, { type: "model/gltf-binary" });
        const uploaded = await api.uploadAsset(file, { kind: "glb", templateId: template.id });
        /*
         * 两步：上传只写对象存储，档案里记 key 还要单独 update。
         * 少这一步模板会显示「未上传模型」—— 而文件其实躺在存储里。
         */
        const saved = await api.update(template.id, {
          glb: { objectKey: uploaded.objectKey, fileName: uploaded.fileName },
        });
        modelUploaded = true;
        return {
          template: saved,
          modelUploaded,
          note:
            "已发布为模板：模型与风格套装已存入平台文件服务器。"
            + "布局与设备绑定属于实例层，不会进模板 —— 新场景会按「模板 → 内置布局」的约定生成骨架，槽位仍需绑定。",
        };
      }
    } catch (error) {
      modelNote = `模型上传失败（${error instanceof Error ? error.message : "网络异常"}），模板只包含风格套装。`;
    }
  }

  /*
   * 把风格套装落成模板里的**真实文件**（2026-11-24）。
   *
   * <h3>为什么必须这么做</h3>
   *
   * <p>客户提出：「风格套装看看有没有相关的文件方式…要不怎么实现 AI 编程」。
   *
   * <p>此前模板里只有 `model.glb`（只读），套装定义是 Java 硬编码 ——
   * 文件管理器打开后没有任何可编辑文件，AI 也无从下手。
   * 现在写成 `style-pack.json`：人能改、AI 能改，保存后
   * 后端同步进 `additionalInfo.stylePackConfig`，
   * `GET /energy/topology-style-packs` 会用模板里的配置覆盖官方默认。
   *
   * <p>失败**不阻断发布**：模板已经建好了，少一个配置文件比整体失败好。
   * 但要留下来源说明 —— 静默失败会让人以为「模板本来就只有模型」。
   */
  let styleNote = "";
  if (stylePack) {
    try {
      const catalog = await getTopologyApi().stylePacks();
      const packId = stylePack.split("@")[0]?.trim();
      const pack = (catalog?.packs ?? []).find((item) => item?.packId === packId);
      if (!pack) {
        styleNote = `官方套装清单里找不到 ${stylePack}，模板未附 style-pack.json。`;
      } else {
        /* 只保留定义字段：source / templateId 是后端合并时补的运行时信息 */
        const config = {
          packId: pack.packId,
          packVersion: pack.packVersion ?? "1.0.0",
          stylePack: pack.stylePack ?? stylePack,
          label: pack.label ?? pack.packId,
          description: pack.description ?? "",
          suitability: pack.suitability ?? "",
          defaultBaseType: pack.defaultBaseType ?? "auto",
          requireWeatherSite: Boolean(pack.requireWeatherSite),
          render: pack.render ?? {},
        };
        await api.createFile(template.id, "style-pack.json", JSON.stringify(config, null, 2));
      }
    } catch (error) {
      styleNote = `style-pack.json 写入失败（${error instanceof Error ? error.message : "网络异常"}）。`;
    }
  }

  /*
   * 附一份「现场资料与需求」骨架（2026-11-24）。
   *
   * <p>客户原话：「每个模板最起码要让用户提供真实的资料信息，这样 AI 才会
   * 知道怎么开发，所以模板是 AI 和用户针对性沟通需求的桥梁」。
   *
   * <p>骨架是一份**结构化访谈提纲**（场站 / 设备清单 / 上报指标 / 统计口径 /
   * 告警定义 / 布局视觉 / 禁忌 / 术语），不是泛泛几行 ——
   * 空模板配一份含糊的说明，AI 只能说正确的废话。
   *
   * <p>不覆盖已有内容（`createFile` 重名即拒）。失败只记 note：
   * 模板已经建好，少一份骨架不影响可用性。
   */
  let requirementsNote = "";
  try {
    await api.createFile(template.id, "requirements.md", buildRequirementsSkeleton(template.name));
  } catch (error) {
    requirementsNote = `requirements.md 写入失败（${error instanceof Error ? error.message : "网络异常"}）。`;
  }

  return {
    template,
    modelUploaded,
    note:
      `已创建模板档案${modelNote ? `；${modelNote}` : ""}`
      + (styleNote ? `；${styleNote}` : "")
      + (requirementsNote ? `；${requirementsNote}` : "")
      + "布局与设备绑定属于实例层，不会进模板。",
  };
}
