import { Spin } from "antd";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSession";
import { customerScopePath } from "../../auth/access";
import { writeLastCustomerId, usableCustomerId } from "../../auth/customer-scope";
import { EditorShell } from "../../features/scene-editor/EditorShell";
import { SceneOpenFailed } from "../entry/SceneOpenFailed";
import { useCustomerName } from "../entry/useCustomerName";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";

export function StudioEditorPage() {
  const { sceneId } = useParams();
  const { role, customerId } = useAuthSession();
  const load = useSceneStore((s) => s.load);
  const reset = useSceneStore((s) => s.reset);
  const loading = useSceneStore((s) => s.loading);
  const document = useSceneStore((s) => s.document);
  const error = useSceneStore((s) => s.error);
  const scopeId = usableCustomerId(customerId) ?? usableCustomerId(document?.platform?.customerId);
  const customerName = useCustomerName(scopeId);

  useEffect(() => {
    if (sceneId) void load(sceneId, { role, customerId: usableCustomerId(customerId) });
    return () => {
      reset();
      useSelectionStore.getState().clear();
    };
  }, [sceneId, load, reset, role, customerId]);

  useEffect(() => {
    const id = usableCustomerId(document?.platform?.customerId);
    if (id) writeLastCustomerId(id);
  }, [document?.platform?.customerId]);

  if (loading) {
    return (
      <div className="page" style={{ alignItems: "center", justifyContent: "center", color: "var(--ngx-color-muted)", background: "var(--ngx-color-bg)" }}>
        <Spin description="正在打开场景" />
      </div>
    );
  }
  if (error || !document) {
    return (
      <SceneOpenFailed
        message={error}
        backTo={customerScopePath(scopeId)}
        backLabel={scopeId ? "返回场景管理" : "返回选择客户"}
        customerName={customerName}
      />
    );
  }

  return <EditorShell />;
}
