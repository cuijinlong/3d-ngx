
import { Typography } from "antd";
import type { SceneEntity } from "@idt/shared-types";

/** 仅展示对象信息。产品不是场景编辑器，不提供改位置/旋转/缩放的入口。 */
export function PropertyPanel({ entity }: { entity?: SceneEntity }) {
  if (!entity) {
    return <div style={{ padding: 12, color: "var(--ngx-color-muted)" }}>在场景中点选模型，或从设备列表选择。</div>;
  }

  return (
    <div style={{ padding: 12, display: "grid", gap: 10 }}>
      <div>
        <Typography.Text type="secondary">名称</Typography.Text>
        <div>{entity.name}</div>
      </div>
      <div>
        <Typography.Text type="secondary">节点</Typography.Text>
        <div>{entity.nodeName || entity.name || "未命名对象"}</div>
      </div>
      <div style={{ color: "var(--ngx-color-muted)", fontSize: 12 }}>
        模型位置以 GLB 为准，这里只做可视化与绑定，不会改写模型里的坐标。
      </div>
    </div>
  );
}
