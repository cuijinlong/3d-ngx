import { Picker, type Application, type CameraComponent, type Entity, type MeshInstance } from "playcanvas";
import { EngineManager } from "../core/EngineManager";

/** 长期持有的拾取缓冲尺寸。不要用画布分辨率，避免每次 hover 全屏 new Picker + prepare。 */
export const PICK_BUFFER_SIZE = 32;

export function mapPointerToPickBuffer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  size = PICK_BUFFER_SIZE,
): { x: number; y: number } {
  const width = rect.width || 1;
  const height = rect.height || 1;
  const x = Math.min(size - 1, Math.max(0, Math.floor(((clientX - rect.left) / width) * size)));
  const y = Math.min(size - 1, Math.max(0, Math.floor(((clientY - rect.top) / height) * size)));
  return { x, y };
}

class SharedPicker {
  private picker: Picker | null = null;
  private app: Application | null = null;

  acquire(app: Application): Picker {
    if (this.picker && this.app === app) return this.picker;
    this.dispose();
    this.app = app;
    this.picker = new Picker(app, PICK_BUFFER_SIZE, PICK_BUFFER_SIZE);
    return this.picker;
  }

  dispose(app?: Application | null): void {
    if (app && this.app && app !== this.app) return;
    this.picker?.destroy();
    this.picker = null;
    this.app = null;
  }
}

const sharedPicker = new SharedPicker();

export function disposeSharedPicker(app?: Application | null): void {
  sharedPicker.dispose(app);
}

export async function pickEntityAt(clientX: number, clientY: number): Promise<Entity | null> {
  const app = EngineManager.instance.app;
  if (!app) return null;
  const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const sample = mapPointerToPickBuffer(clientX, clientY, rect, PICK_BUFFER_SIZE);

  const cameras = app.root.findComponents("camera") as CameraComponent[];
  const camera = cameras[0];
  if (!camera) return null;

  const picker = sharedPicker.acquire(app);
  const worldLayer = app.scene.layers.getLayerByName("World");
  const layers = worldLayer ? [worldLayer] : undefined;
  await picker.prepare(camera, app.scene, layers);
  const selection = picker.getSelection(sample.x, sample.y) as MeshInstance[];
  const mesh = selection[0];
  if (!mesh) return null;
  const node = (mesh as unknown as { node?: Entity; entity?: Entity }).node
    ?? (mesh as unknown as { entity?: Entity }).entity;
  if (!node) return null;
  return climbToNamed(node);
}

function climbToNamed(entity: Entity): Entity {
  const root = EngineManager.instance.model?.root;
  let current: Entity | null = entity;
  let lastNamed = entity;
  while (current && current !== root) {
    if (current.name && EngineManager.instance.findEntity(current.name) === current) {
      lastNamed = current;
      break;
    }
    current = current.parent as Entity | null;
  }
  current = lastNamed.parent as Entity | null;
  while (current && current !== root) {
    if (current.name && EngineManager.instance.findEntity(current.name)) {
      return current;
    }
    current = current.parent as Entity | null;
  }
  return lastNamed;
}
