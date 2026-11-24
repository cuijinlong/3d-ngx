import { describe, expect, it, vi } from "vitest";
import type { GuardClient } from "./guard-client";
import { SceneTemplateApi, parseSceneTemplateList } from "./scene-template-client";

describe("scene template client", () => {
  it("parses a template list and never treats a template as a topology card", () => {
    const rows = parseSceneTemplateList({
      items: [{ id: "tpl-1", name: "冷冻机房模板", templateVersion: "1.0.0" }],
    });
    expect(rows).toEqual([{ id: "tpl-1", name: "冷冻机房模板", templateVersion: "1.0.0" }]);
  });

  it("calls the tenant-only scene-templates and scene-template-assets paths", async () => {
    const requestJson = vi.fn(async (method: string, path: string) => {
      if (method === "GET" && path === "/api/energy/scene-templates") {
        return { items: [{ id: "tpl-1", name: "冷冻机房模板" }] };
      }
      if (method === "POST" && path === "/api/energy/scene-templates") {
        return { id: "tpl-2", name: "新模板" };
      }
      if (method === "GET" && path === "/api/energy/scene-templates/tpl-1") {
        return { id: "tpl-1", name: "冷冻机房模板" };
      }
      if (method === "POST" && path === "/api/energy/scene-templates/tpl-1") {
        return { id: "tpl-1", name: "改名模板" };
      }
      return { ok: true };
    });
    const requestForm = vi.fn().mockResolvedValue({ objectKey: "scene-template/t/inbox/u/model.glb", kind: "glb" });
    const api = new SceneTemplateApi({ requestJson, requestForm } as unknown as GuardClient);

    expect(await api.list()).toEqual([{ id: "tpl-1", name: "冷冻机房模板" }]);
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/energy/scene-templates");

    const created = await api.create({ name: "新模板" });
    expect(created.id).toBe("tpl-2");
    expect(requestJson).toHaveBeenCalledWith("POST", "/api/energy/scene-templates", { name: "新模板", description: undefined, templateVersion: undefined });

    expect((await api.get("tpl-1")).name).toBe("冷冻机房模板");
    await api.update("tpl-1", { name: "改名模板" });
    expect(requestJson).toHaveBeenCalledWith("POST", "/api/energy/scene-templates/tpl-1", { name: "改名模板", description: undefined, templateVersion: undefined });

    await api.delete("tpl-1");
    expect(requestJson).toHaveBeenCalledWith("DELETE", "/api/energy/scene-templates/tpl-1");

    await api.uploadAsset(new File(["glb"], "model.glb"), { kind: "glb", templateId: "tpl-1" });
    expect(requestForm).toHaveBeenCalled();
    const uploadPath = requestForm.mock.calls[0][0] as string;
    const uploadForm = requestForm.mock.calls[0][1] as FormData;
    expect(uploadPath).toBe("/api/energy/scene-template-assets?kind=glb&templateId=tpl-1");
    expect(uploadForm.get("kind")).toBeNull();
    expect(api.assetUrl("scene-template/t/x/model.glb")).toBe(
      "/api/energy/scene-template-assets?objectKey=scene-template%2Ft%2Fx%2Fmodel.glb",
    );
    await api.deleteAsset("scene-template/t/x/model.glb");
    expect(requestJson).toHaveBeenCalledWith(
      "DELETE",
      "/api/energy/scene-template-assets?objectKey=scene-template%2Ft%2Fx%2Fmodel.glb",
    );
  });
});

/**
 * 模板库页面（2026-11-23 新增）依赖的解析与写入行为。
 *
 * 全是实测过的平台回包形状：`glb` 既可能是对象也可能是字符串，
 * `stylePack` 与模型一起存 —— 解析漏一个，界面上就显示「未上传模型」，
 * 而文件其实好好躺在对象存储里。
 */
describe("scene template client / 模板库页面契约", () => {
  it("解析实测回包：glb 是对象、带 stylePack", () => {
    const card = parseSceneTemplateList({
      data: [{
        id: "134b61b0-e69c-11f1-a6a8-01523035eefa",
        name: "tpl-冷热站标准版",
        label: "冷热站标准版",
        templateVersion: "1.0.0",
        description: "天骄冷热站",
        packId: "hvac-hud-v1",
        packVersion: "1.0.0",
        stylePack: "hvac-hud-v1@1.0.0",
        glb: {
          objectKey: "scene-template/t/134b61b0/model.glb",
          fileName: "天骄科技园.glb",
        },
      }],
    });

    expect(card).toHaveLength(1);
    expect(card[0]?.id).toBe("134b61b0-e69c-11f1-a6a8-01523035eefa");
    expect(card[0]?.name).toBe("冷热站标准版");
    expect(card[0]?.stylePack).toBe("hvac-hud-v1@1.0.0");
    // 对象形态的 glb 必须被解出来，否则界面显示「未上传模型」
    expect(card[0]?.glbObjectKey).toBe("scene-template/t/134b61b0/model.glb");
  });

  it("glb 是字符串时同样解析（旧回包形态）", () => {
    const card = parseSceneTemplateList({
      data: [{ id: "tpl-1", name: "旧模板", glb: "scene-template/t/tpl-1/model.glb" }],
    });
    expect(card[0]?.glbObjectKey).toBe("scene-template/t/tpl-1/model.glb");
  });

  it("没有 glb 时不编造 objectKey", () => {
    const card = parseSceneTemplateList({ data: [{ id: "tpl-1", name: "空模板" }] });
    expect(card[0]?.glbObjectKey).toBeUndefined();
  });

  it("update 只提交给出的字段（不把没改的字段覆盖成空）", async () => {
    const requestJson = vi.fn(async () => ({ id: "tpl-1", name: "只改名" }));
    const api = new SceneTemplateApi({ requestJson } as unknown as GuardClient);

    await api.update("tpl-1", { name: "只改名" });

    const [, , body] = requestJson.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(body).toEqual({ name: "只改名" });
    // description 没给，就不能出现在 body 里 —— 否则后端可能按 null 清空
    expect("description" in body).toBe(false);
    expect("glb" in body).toBe(false);
  });

  it("update 能提交 glb 与 stylePack（写档案那一步）", async () => {
    const requestJson = vi.fn(async () => ({ id: "tpl-1", name: "x" }));
    const api = new SceneTemplateApi({ requestJson } as unknown as GuardClient);

    await api.update("tpl-1", {
      glb: { objectKey: "scene-template/t/tpl-1/model.glb", fileName: "a.glb" },
      stylePack: "hvac-hud-v1@1.0.0",
    });

    const [, , body] = requestJson.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(body.glb).toEqual({ objectKey: "scene-template/t/tpl-1/model.glb", fileName: "a.glb" });
    expect(body.stylePack).toBe("hvac-hud-v1@1.0.0");
  });

  it("downloadAsset 走 scene-template-assets 并返回 ArrayBuffer", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]); // "glTF"
    const requestBytes = vi.fn().mockResolvedValue({
      blob: new Blob([bytes]),
      contentType: "model/gltf-binary",
    });
    const api = new SceneTemplateApi({ requestBytes } as unknown as GuardClient);

    const buffer = await api.downloadAsset("scene-template/t/tpl-1/model.glb");

    expect(requestBytes).toHaveBeenCalledTimes(1);
    const [path] = requestBytes.mock.calls[0] as unknown as [string];
    expect(path).toContain("/api/energy/scene-template-assets?objectKey=");
    // objectKey 必须被 URL 编码，否则 key 里的 "/" 会被当成路径
    expect(path).toContain("scene-template%2Ft%2Ftpl-1%2Fmodel.glb");
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });
});

/*
 * 客户端专用的两个只读能力（2026-11-23）。
 *
 * <p>背景：`GET /scene-templates` 后端限 TENANT_ADMIN，客户建场景时必然 403。
 * 所以新增 `scene-template-options`（只读、含客户权限、不含 objectKey）
 * 和 `scene-template-options/{id}/model`（服务端按 id 拼 key）。
 */
describe("scene template client · 客户可用接口", () => {
  const makeApi = (over: {
    json?: (method: string, path: string) => unknown;
    bytes?: (path: string) => unknown;
  } = {}) => {
    const requestJson = vi.fn(async (method: string, path: string) => {
      if (over.json) return over.json(method, path);
      return { data: [] };
    });
    const requestBytes = vi.fn(async (path: string) => {
      if (over.bytes) return over.bytes(path);
      return { blob: new Blob([new Uint8Array([1, 2, 3])]), contentType: "model/gltf-binary" };
    });
    return { api: new SceneTemplateApi({ requestJson, requestBytes } as unknown as GuardClient), requestJson, requestBytes };
  };

  it("★ options 走客户可用的路径，而不是租户专用的 scene-templates", async () => {
    const { api, requestJson } = makeApi({
      json: () => ({ data: [{ id: "tpl-1", label: "冷热站标准版", hasModel: true }], total: 1 }),
    });
    const rows = await api.options();
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/energy/scene-template-options");
    expect(rows[0]?.name).toBe("冷热站标准版");
    /* 后端给的是布尔，必须沿用 —— 界面靠它显示「含模型 / 仅布局」 */
    expect(rows[0]?.hasModel).toBe(true);
  });

  it("options 回包没有 objectKey 时也能解析（这是常态，不是异常）", async () => {
    const { api } = makeApi({
      json: () => ({ data: [{ id: "tpl-2", label: "仅布局" }] }),
    });
    const rows = await api.options();
    expect(rows[0]?.glbObjectKey).toBeUndefined();
    expect(rows[0]?.hasModel).toBeUndefined();
  });

  it("★ downloadModel 用 templateId 拼路径，绝不暴露 objectKey", async () => {
    const { api, requestBytes } = makeApi();
    const buffer = await api.downloadModel("tpl 1/2");
    expect(requestBytes).toHaveBeenCalledWith("/api/energy/scene-template-options/tpl%201%2F2/model");
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("★ hasModel 只认布尔：字符串 \"false\" 不能被当成有模型", () => {
    const rows = parseSceneTemplateList({ data: [{ id: "a", label: "A", hasModel: "false" }] });
    expect(rows[0]?.hasModel).toBeUndefined();
  });
});

/*
 * 模板文件资源管理器（2026-11-24）。
 *
 * <p>这里钉住三件「错了会静默出事」的事：
 * ① 路径必须按 templateId + 文件名走，不能让调用方拼 objectKey；
 * ② `editable` 只认布尔 true（后端给，前端不猜扩展名）；
 * ③ 写文件时 body 是 `{name, content}`，content 允许空串（清空是合法操作）。
 */
describe("scene template client · 文件资源管理器", () => {
  const makeApi = (json: (method: string, path: string, body?: unknown) => unknown) => {
    const requestJson = vi.fn(async (method: string, path: string, body?: unknown) => json(method, path, body));
    return { api: new SceneTemplateApi({ requestJson } as unknown as GuardClient), requestJson };
  };

  it("★ listFiles 走 templateId/files，不暴露 objectKey", async () => {
    const { api, requestJson } = makeApi(() => ({
      files: [
        { name: "hud-override.css", kind: "pack", ext: "css", editable: true },
        { name: "model.glb", kind: "glb", ext: "glb", editable: false },
      ],
      total: 2,
    }));
    const files = await api.listFiles("tpl-1");
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/energy/scene-templates/tpl-1/files");
    expect(files.map((f) => f.name)).toEqual(["hud-override.css", "model.glb"]);
    expect(files[0]?.editable).toBe(true);
    expect(files[1]?.editable).toBe(false);
  });

  it("★ editable 只认布尔 true —— 字符串 \"true\" 不能当成可编辑", async () => {
    const { api } = makeApi(() => ({
      files: [{ name: "a.glb", kind: "glb", ext: "glb", editable: "true" }],
    }));
    const files = await api.listFiles("tpl-1");
    expect(files[0]?.editable).toBe(false);
  });

  it("★ readFile 按 name 查询参数编码（文件名带空格/中文不能拼坏 URL）", async () => {
    const { api, requestJson } = makeApi(() => ({ name: "我的 样式.css", ext: "css", size: 42, content: "a{}" }));
    const file = await api.readFile("tpl-1", "我的 样式.css");
    expect(requestJson).toHaveBeenCalledWith(
      "GET",
      `/api/energy/scene-templates/tpl-1/files/content?name=${encodeURIComponent("我的 样式.css")}`,
    );
    expect(file.content).toBe("a{}");
    expect(file.size).toBe(42);
  });

  it("★ writeFile 的 body 是 {name, content}，允许清空", async () => {
    const { api, requestJson } = makeApi(() => ({ ok: true, size: 0 }));
    const r = await api.writeFile("tpl-1", "a.css", "");
    expect(requestJson).toHaveBeenCalledWith(
      "POST",
      "/api/energy/scene-templates/tpl-1/files/content",
      { name: "a.css", content: "" },
    );
    expect(r.ok).toBe(true);
  });

  it("空清单不报错（模板可以只有档案没有资源）", async () => {
    const { api } = makeApi(() => ({ files: [], total: 0 }));
    expect(await api.listFiles("tpl-1")).toEqual([]);
  });
});
