import { useEffect, useState } from "react";
import { useApp } from "@playcanvas/react/hooks";
import styles from "./ViewportHud.module.css";

/**
 * 3D 视口的 HUD 装饰层（2026-11-23）。
 *
 * <h2>为什么需要它</h2>
 *
 * 对齐 `template01/index.html` 的 3D 区域——参考模板在 canvas 之上叠了四层信息：
 *
 * <pre>
 * ┌──────────────────────────────────────────────┐
 * │ 园区三维场景 / CAMPUS 3D SCENE   [视角][图层][全屏] │  ← scene-topline
 * │ SCENE：xxx        ╭──────────────╮  FPS：58  │  ← viewport-hud
 * │ LAYER：ALL        │   canvas     │  CAM：PERSPECTIVE │
 * │                   ╰──────────────╯            │
 * │ 坐标系：项目本地   X: 0.00  Y: 0.00  Z: 0.00  │  ← hud-bottom
 * └──────────────────────────────────────────────┘
 * </pre>
 *
 * <p>去掉这层，3D 区域就只是一块「有模型的画布」；加上它才像工业监控大屏。
 * 这是和参考图最直观的差距之一。
 *
 * <h2>为什么用真实值而不是写死</h2>
 *
 * 参考模板里 `FPS：--` / `X: 0.00` 是占位。我们接真值：
 * FPS 来自 rAF 间隔，坐标来自相机世界位置。
 * 写死一串数字看起来一样，但一旦现场问「帧率多少」就露馅，
 * 而且假数据会掩盖性能问题。
 */

/** 采样间隔。逐帧 setState 会让 React 成为瓶颈；500ms 对人眼看数字足够。 */
const SAMPLE_INTERVAL_MS = 500;

export function ViewportHud({
  sceneName,
  layerLabel = "ALL OBJECTS",
}: {
  sceneName?: string;
  layerLabel?: string;
}) {
  const app = useApp();
  const [fps, setFps] = useState<number | null>(null);
  const [pos, setPos] = useState<[number, number, number] | null>(null);

  /*
   * 用定时器采样，不用 useFrame（2026-11-23 实测）。
   *
   * <p>`useFrame` 是 `useAppEvent('update', cb)`，内部用 `useCallback(..., [cb])`。
   * 我们的回调每帧都 setState → 重渲染 → 新回调 → 重新订阅，
   * 实际跑起来一次都没采到样，HUD 上永远显示 `FPS：--`。
   *
   * <p>而且 `app.stats.frame.fps` 本来就是 PlayCanvas 自己统计好的，
   * 没必要自己算 rAF 间隔。
   */
  /*
   * 帧率自己数（2026-11-23）。
   *
   * <p>先说试过但不行的：`app.stats.frame.fps` 实测恒为空 ——
   * PlayCanvas 的 stats 采样需要额外开启，默认没有值，HUD 上一直是 `FPS：--`。
   * 用我们自己组件里的 `useFrame`（= `useAppEvent('update')`）也不行：
   * 它的内部用 `useCallback(..., [cb])`，而我们的回调每帧 setState →
   * 重渲染 → 新回调 → 重新订阅，实测一次样都采不到。
   *
   * <p>所以用一个独立的 rAF 计数器：只数帧、不干预渲染，每 500ms 结算一次。
   */
  useEffect(() => {
    let frames = 0;
    let lastAt = performance.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      const elapsed = now - lastAt;
      if (elapsed >= SAMPLE_INTERVAL_MS) {
        const value = Math.round((frames * 1000) / elapsed);
        /*
         * 只在 >0 时写。headless / 页面在后台时 Chrome 会把 rAF 节流，
         * 算出来是 0 —— 显示「FPS：0」看起来像坏了，
         * 而「--」至少表达「还没测到」。
         */
        if (value > 0) setFps(value);
        frames = 0;
        lastAt = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* 相机坐标：与帧率分开采样，读不到就保持上一次（不清成 0）。 */
  useEffect(() => {
    if (!app) return;
    const sample = () => {
      try {
        const cameras = app.root.findComponents("camera") as Array<{
          entity?: { getPosition?: () => { x: number; y: number; z: number } };
        }>;
        const p = cameras[0]?.entity?.getPosition?.();
        if (p) setPos([p.x, p.y, p.z]);
      } catch {
        /* 相机还没建好 —— 保持上一次的坐标，不要清成 0 */
      }
    };
    sample();
    const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [app]);

  const fmt = (n: number) => n.toFixed(1).padStart(5, " ");

  return (
    <div className={styles.hud} data-testid="viewport-hud" aria-hidden>
      <div className={styles.top}>
        <span className={styles.title}>
          <strong>{sceneName || "三维场景"}</strong>
          <em>SCENE VIEW</em>
        </span>
      </div>

      <div className={styles.corners}>
        <div className={styles.chipColumn}>
          <span className={styles.chip}>SCENE：{sceneName || "—"}</span>
          <span className={styles.chip}>LAYER：{layerLabel}</span>
        </div>
        <div className={`${styles.chipColumn} ${styles.chipRight}`}>
          <span className={styles.chip}>FPS：{fps ?? "--"}</span>
          <span className={styles.chip}>CAM：PERSPECTIVE</span>
        </div>
      </div>

      <div className={styles.bottom}>
        <span>坐标系：项目本地坐标 · 单位：m</span>
        <span className={styles.coord}>
          {pos
            ? `X: ${fmt(pos[0])}　Y: ${fmt(pos[1])}　Z: ${fmt(pos[2])}`
            : "X: --　Y: --　Z: --"}
        </span>
      </div>
    </div>
  );
}
