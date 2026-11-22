
import { Entity } from "@playcanvas/react";
import { Environment, Light, Render } from "@playcanvas/react/components";
import { useApp } from "@playcanvas/react/hooks";
import { Color, StandardMaterial, TONEMAP_ACES2, Vec3 } from "playcanvas";
import { useEffect } from "react";
import { DEFAULT_ENGINE_CONFIG } from "../core/EngineConfig";

export function SceneLights({ gridEnabled = true }: { gridEnabled?: boolean }) {
  const app = useApp();
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
    mat.diffuse = new Color().fromString(DEFAULT_ENGINE_CONFIG.clearColor);
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
  }, [app]);

  useEffect(() => {
    if (!gridEnabled) return;
    const size = DEFAULT_ENGINE_CONFIG.gridSize;
    const step = DEFAULT_ENGINE_CONFIG.gridStep;
    // 对照图是很浅的图纸网格，不要用粗红蓝轴
    const minor = new Color(0.82, 0.85, 0.89);
    const major = new Color(0.74, 0.78, 0.84);
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
  }, [app, gridEnabled]);

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
