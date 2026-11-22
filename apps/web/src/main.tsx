import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyDocumentTheme, readStoredTheme } from "@idt/config";
import { App } from "./app/App";
import "@idt/config/theme.css";
import "antd/dist/reset.css";
import "./styles/global.css";

applyDocumentTheme(readStoredTheme(), { persist: false });

const root = document.getElementById("root");
if (!root) {
  throw new Error("找不到根节点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
