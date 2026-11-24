// React + PlayCanvas host integration example (TypeScript)
// Install and mount PlayCanvas in the host application. This file is a contract example,
// not bundled into the static HTML preview.
import React, { useEffect, useRef } from "react";
import * as pc from "playcanvas";

type CampusSceneProps = {
  sceneUrl?: string;
  onEntitySelect?: (entity: { entityId: string; name?: string }) => void;
};

export function CampusSceneViewport({ sceneUrl, onEntitySelect }: CampusSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new pc.Application(host, {
      mouse: new pc.Mouse(host),
      touch: new pc.TouchDevice(host),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { antialias: true, alpha: true }
    });

    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.start();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      app.resizeCanvas(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // TODO: load the GLB/GLTF scene using the asset pipeline that matches your PlayCanvas version.
    // Keep scene entity IDs stable so React widgets and AI-generated interactions can address them.
    // TODO: add raycast/picking and emit `campus:entity-select` on selected entity.

    return () => {
      observer.disconnect();
      app.destroy();
    };
  }, [sceneUrl]);

  return <div ref={hostRef} id="pc-canvas-root" data-playcanvas-mount="true"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
