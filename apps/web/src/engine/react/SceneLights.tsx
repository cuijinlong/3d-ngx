
import { Entity } from "@playcanvas/react";
import { Environment, Light, Render } from "@playcanvas/react/components";
import { useApp } from "@playcanvas/react/hooks";
import { Color, StandardMaterial, TONEMAP_ACES2, Vec3 } from "playcanvas";
import { useEffect } from "react";
import { DEFAULT_ENGINE_CONFIG } from "../core/EngineConfig";

export function SceneLights({ gridEnabled = true, clearColor, groundColor }: { gridEnabled?: boolean; clearColor?: string; groundColor?: string }) {
  const app = useApp();

  /*
   * 清屏色必须设在 scene 上，不能设在 camera 上（2026-11-23 实测）。
   *
   * <p>`<Camera clearColor={...}/>` **完全不生效**，原因在 @playcanvas/react
   * 的 `getPseudoPublicProps`：
   *
   * ```js
   * if (hasSetter && !hasGetter) return;   // 只有 setter 没有 getter → 跳过
   * ```
   *
   * <p>PlayCanvas 的 `CameraComponent.clearColor` 恰好只有 setter、没有 getter，
   * 于是它不进 schema；`applyProps` 里 `if (key in schema)` 不命中，
   * 静默不应用 —— **连警告都没有**。
   *
   * <p>后果：清屏色一直是 Scene 默认的 `(0.75,0.75,0.75)` 灰白，
   * 深色大屏里 3D 区域看着是白底，卡片 42% 白叠上去就成了整片白。
   * 我们一度误判成 headless swiftshader 的渲染偏差 —— 其实真实浏览器一样白。
   */
  useEffect(() => {
    if (!clearColor) return;
    const scene = app.scene as unknown as { clearColor: Color };
    scene.clearColor = new Color().fromString(clearColor);
  }, [app, clearColor]);

  useEffect(() => {
    const scene = app.scene as unknown as {
      ambientLight: Color;
      exposure: number;
      rendering?: { toneMapping: number };
      skyboxIntensity?: number;
    };
    scene.ambientLight = new Color().fromString(DEFAULT_ENGINE_CONFIG.ambient);
    scene.exposure = DEFAULT_ENGINE_CONFIG.exposure;
    if (scene.rendering) scene.rendering.toneMapping = TONEMAP_ACES2;
    if (typeof scene.skyboxIntensity === "number") scene.skyboxIntensity = 0.35;
  }, [app]);

  useEffect(() => {
    const entity = app.root.findByName("ground") as unknown as {
      render?: { meshInstances?: Array<{ material?: StandardMaterial; receiveShadow?: boolean; castShadow?: boolean }>; receiveShadows?: boolean; castShadows?: boolean };
    } | null;
    if (!entity?.render) return;
    const mat = new StandardMaterial();
    /*
     * 地面颜色必须跟主题走（2026-11-23 实测）。
     *
     * <p>原来固定用 `DEFAULT_ENGINE_CONFIG.clearColor`（#eef2f6 浅纸面）——
     * 这块 200×200 的地面从相机俯视角看几乎铺满视野，于是深色大屏里
     * 3D 区域整片发白，看起来像「清屏色没生效」。
     *
     * <p>实测排错路径：先确认 `scene.clearColor` 确实是 #071018（探针读到
     * 0.027/0.063/0.094），截图却仍是纯白 —— 才定位到是地面盖住了。
     * 清屏色和地面是两回事，改一个不影响另一个。
     */
    mat.diffuse = new Color().fromString(groundColor || DEFAULT_ENGINE_CONFIG.clearColor);
    mat.useSkybox = false;
    mat.update();
    const render = entity.render as unknown as {
      meshInstances?: Array<{ material: StandardMaterial; receiveShadow?: boolean; castShadow?: boolean }>;
      receiveShadows?: boolean;
      castShadows?: boolean;
    };
    render.castShadows = false;
    render.receiveShadows = true;
    for (const mi of render.meshInstances ?? []) {
      mi.material = mat;
      mi.receiveShadow = true;
      mi.castShadow = false;
    }
  }, [app, groundColor]);

  useEffect(() => {
    if (!gridEnabled) return;
    const size = DEFAULT_ENGINE_CONFIG.gridSize;
    const step = DEFAULT_ENGINE_CONFIG.gridStep;
    // 对照图是很浅的图纸网格，不要用粗红蓝轴
    /*
     * 网格是「图纸」语义：浅色主题用浅灰线，深色主题必须反相，
     * 否则 0.82 的浅线画在 #071018 上像通电的霓虹格。
     */
    const dark = Boolean(groundColor);
    const minor = dark ? new Color(0.13, 0.18, 0.24) : new Color(0.82, 0.85, 0.89);
    const major = dark ? new Color(0.19, 0.26, 0.34) : new Color(0.74, 0.78, 0.84);
    const onPrerender = () => {
      for (let i = -size; i <= size; i += step) {
        const color = i % 5 === 0 ? major : minor;
        app.drawLine(new Vec3(-size, 0, i), new Vec3(size, 0, i), color, true);
        app.drawLine(new Vec3(i, 0, -size), new Vec3(i, 0, size), color, true);
      }
    };
    app.on("prerender", onPrerender);
    return () => {
      app.off("prerender", onPrerender);
    };
  }, [app, gridEnabled, groundColor]);

  return (
    <>
      <Environment showSkybox={false} />
      <Entity name="sun" rotation={[50, -40, 0]}>
        <Light
          type="directional"
          intensity={1.28}
          color="#fff3e8"
          castShadows
          shadowIntensity={0.38}
          shadowDistance={90}
          shadowResolution={2048}
          shadowBias={0.04}
          normalOffsetBias={0.06}
        />
      </Entity>
      <Entity name="fill" position={[8, 14, 6]}>
        <Light type="omni" intensity={0.28} range={140} color="#f4f7fb" />
      </Entity>
      <Entity name="rim" position={[-12, 8, -10]}>
        <Light type="omni" intensity={0.18} range={120} color="#d7e3f4" />
      </Entity>
      <Entity name="ground" position={[0, -0.02, 0]} scale={[200, 1, 200]}>
        <Render type="plane" />
      </Entity>
    </>
  );
}
