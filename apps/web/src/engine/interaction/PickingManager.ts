
import { Picker, type CameraComponent, type Entity, type MeshInstance } from "playcanvas";
import { EngineManager } from "../core/EngineManager";

export async function pickEntityAt(clientX: number, clientY: number): Promise<Entity | null> {
  const app = EngineManager.instance.app;
  if (!app) return null;
  const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);

  const cameras = app.root.findComponents("camera") as CameraComponent[];
  const camera = cameras[0];
  if (!camera) return null;

  const picker = new Picker(app, canvas.width, canvas.height);
  try {
    const worldLayer = app.scene.layers.getLayerByName("World");
    const layers = worldLayer ? [worldLayer] : undefined;
    await picker.prepare(camera, app.scene, layers);
    const selection = picker.getSelection(x, y) as MeshInstance[];
    const mesh = selection[0];
    if (!mesh) return null;
    const node = (mesh as unknown as { node?: Entity; entity?: Entity }).node
      ?? (mesh as unknown as { entity?: Entity }).entity;
    if (!node) return null;
    return climbToNamed(node);
  } finally {
    picker.destroy();
  }
}

function climbToNamed(entity: Entity): Entity {
  const root = EngineManager.instance.model?.root;
  let current: Entity | null = entity;
  let lastNamed = entity;
  while (current && current !== root) {
    if (current.name && EngineManager.instance.findEntity(current.name) === current) {
      lastNamed = current;
      // 优先返回已登记的设备节点（较短的上层名字可能更接近 HMI node）
      break;
    }
    current = current.parent as Entity | null;
  }
  // 再往上找一层已登记节点，避免点到零件
  current = lastNamed.parent as Entity | null;
  while (current && current !== root) {
    if (current.name && EngineManager.instance.findEntity(current.name)) {
      return current;
    }
    current = current.parent as Entity | null;
  }
  return lastNamed;
}
