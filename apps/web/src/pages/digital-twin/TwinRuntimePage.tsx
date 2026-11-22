import { Spin } from "antd";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSession";
import { customerScopePath } from "../../auth/access";
import { usableCustomerId, writeLastCustomerId } from "../../auth/customer-scope";
import { RuntimeShell } from "../../features/scene-runtime/RuntimeShell";
import { routes } from "../../constants/routes";
import { SceneOpenFailed } from "../entry/SceneOpenFailed";
import { useCustomerName } from "../entry/useCustomerName";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";

export function TwinRuntimePage() {
  const { sceneId } = useParams();
  const { role, customerId } = useAuthSession();
  const load = useSceneStore((s) => s.load);
  const reset = useSceneStore((s) => s.reset);
  const loading = useSceneStore((s) => s.loading);
  const document = useSceneStore((s) => s.document);
  const error = useSceneStore((s) => s.error);

  useEffect(() => {
    if (sceneId) void load(sceneId, { role, customerId: usableCustomerId(customerId) });
    return () => {
      reset();
      useSelectionStore.getState().clear();
    };
  }, [sceneId, load, reset, role, customerId]);

  const scopeId = usableCustomerId(customerId) ?? usableCustomerId(document?.platform?.customerId);
  const customerName = useCustomerName(scopeId);

  useEffect(() => {
    if (scopeId) writeLastCustomerId(scopeId);
  }, [scopeId]);

  if (loading) {
    return <div className="page" style={{ alignItems: "center", justifyContent: "center", color: "var(--ngx-color-muted)", background: "var(--ngx-color-bg)" }}><Spin /></div>;
  }

  if (error || !document) {
    const tenantBack = customerScopePath(scopeId);
    return (
      <SceneOpenFailed
        message={error}
        backTo={role === "tenant" ? tenantBack : routes.runtime}
        backLabel={role === "tenant" ? (scopeId ? "返回场景管理" : "返回选择客户") : "返回默认场景"}
        customerName={customerName}
      />
    );
  }
  return <RuntimeShell />;
}
