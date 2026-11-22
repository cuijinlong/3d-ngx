import { Modal } from "antd";
import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

/** 离开编辑且有未保存改动时先确认，不只显示「未保存」标记。 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const blocker = useBlocker(dirty);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const state = blocker.state;
  const proceed = blocker.proceed;
  const reset = blocker.reset;

  useEffect(() => {
    if (state !== "blocked") return;
    const modal = Modal.confirm({
      title: "有未保存的改动",
      content: "离开后未保存的修改会丢失。确定离开吗？",
      okText: "离开",
      cancelText: "继续编辑",
      onOk: () => proceed?.(),
      onCancel: () => reset?.(),
    });
    return () => modal.destroy();
  }, [state, proceed, reset]);
}
