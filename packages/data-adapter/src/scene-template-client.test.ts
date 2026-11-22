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
    expect(uploadPath).toBe("/api/energy/scene-template-assets?kind=glb&templateId=tpl-1");
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
