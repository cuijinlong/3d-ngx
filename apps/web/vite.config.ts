
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom", "playcanvas"],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      /*
       * `ws: true` 不能漏（2026-11-24）。
       *
       * 遥测走 `ws://host/api/ws` 推送。Vite 不代理 WebSocket 时，
       * 浏览器建连直接失败 —— 而 HTTP 那条照常工作，所以表现为
       * 「页面有数，但实时性变差、每 3 秒还在轮询」，
       * 很难联想到是 dev server 没转发升级请求。
       */
      "/api": {
        target: "http://127.0.0.1:8090",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  /*
   * ★ `preview` 也必须代理 `/api`（2026-11-23 补）。
   *
   * <p>原配置只有 `host/port`。用 `pnpm build && pnpm preview` 在局域网
   * 另一台机器访问时，前端从 5173 加载正常，但所有 `/api/...` 请求
   * 都打到 5173 本身 —— 没有代理就是 404。
   *
   * <p>症状特别容易误判：**页面能打开、3D 模型却没有**，
   * 因为 GLB 是通过 `/api/energy/topology-assets?objectKey=...` 下载的。
   * 看起来像「模型没存到服务器」，实际是接口根本没通。
   *
   * <p>真正上生产要走 nginx，那时候这条不起作用 —— nginx 侧同样必须
   * 转发 `/api` 且放开大文件（模型 10MB 级）。见 docs/deployment.md。
   */
  preview: {
    host: true,
    port: 5173,
    proxy: {
      /*
       * `ws: true` 不能漏（2026-11-24）。
       *
       * 遥测走 `ws://host/api/ws` 推送。Vite 不代理 WebSocket 时，
       * 浏览器建连直接失败 —— 而 HTTP 那条照常工作，所以表现为
       * 「页面有数，但实时性变差、每 3 秒还在轮询」，
       * 很难联想到是 dev server 没转发升级请求。
       */
      "/api": {
        target: "http://127.0.0.1:8090",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
