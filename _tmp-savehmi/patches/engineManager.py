from pathlib import Path
p = Path("apps/web/src/engine/core/EngineManager.ts")
text = p.read_text()
old_imp = 'import { pickIndicatorNodeNames, pickSpinNodeNames } from "../animation/visual-nodes";'
new_imp = 'import { pickDoorNodeNames, pickGaugeNodeNames, pickIndicatorNodeNames, pickSpinNodeNames } from "../animation/visual-nodes";'
if old_imp not in text:
    raise SystemExit("visual-nodes import not found")
text = text.replace(old_imp, new_imp, 1)

old_fields = '''  private animationState = new Map<string, { playing: boolean; kind: string }>();
  private spinNodes = new Set<Entity>();
'''
new_fields = '''  private animationState = new Map<string, { playing: boolean; kind: string }>();
  private spinNodes = new Set<Entity>();
  private swingNodes = new Map<Entity, { kind: "gauge" | "door"; t: number; base: [number, number, number] }>();
'''
if old_fields not in text:
    raise SystemExit("fields not found")
text = text.replace(old_fields, new_fields, 1)

old_tick = '''  tickAnimations(dt: number): void {
    for (const entity of this.spinNodes) {
      entity.rotateLocal(0, 0, dt * 180);
    }
  }

  playNamedAnimation(clip: string, play: boolean): void {
    const root = this.model?.root;
    const app = this.app;
    if (!root || !app) return;
    const entity = this.model?.byName.get(clip.split("_")[0] ?? "") ?? root;
    const anim = (entity as unknown as { anim?: { assignAnimation?: (name: string, asset: unknown) => void; baseLayer?: { play?: (name: string) => void; stop?: () => void } }; animation?: { play?: (name: string) => void; stop?: () => void } });
    try {
      if (play) {
        anim.animation?.play?.(clip);
        anim.anim?.baseLayer?.play?.(clip);
      } else {
        anim.animation?.stop?.();
        anim.anim?.baseLayer?.stop?.();
      }
    } catch {
      /* 动画组件因模型导出差异可能不存在，旋转回退已覆盖风扇类动作 */
    }
    this.animationState.set(clip, { playing: play, kind: clip });
  }
'''
new_tick = '''  tickAnimations(dt: number): void {
    for (const entity of this.spinNodes) {
      entity.rotateLocal(0, 0, dt * 180);
    }
    for (const [entity, state] of this.swingNodes) {
      state.t += dt;
      const angle = Math.sin(state.t * 3) * (state.kind === "gauge" ? 20 : 40);
      if (state.kind === "gauge") {
        entity.setLocalEulerAngles(state.base[0] + angle, state.base[1], state.base[2]);
      } else {
        entity.setLocalEulerAngles(state.base[0], state.base[1] + angle, state.base[2]);
      }
    }
  }

  setSwing(nodeName: string, playing: boolean, kind: "gauge" | "door"): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    const named = collectSubtree(entity).filter((node) => node !== entity);
    const picked = new Set((kind === "gauge" ? pickGaugeNodeNames : pickDoorNodeNames)(named.map((node) => node.name || "")));
    const targets = named.filter((node) => picked.has(node.name));
    for (const node of targets) {
      if (playing) {
        const existing = this.swingNodes.get(node);
        if (existing) {
          existing.kind = kind;
          continue;
        }
        const euler = node.getLocalEulerAngles();
        this.swingNodes.set(node, { kind, t: 0, base: [euler.x, euler.y, euler.z] });
      } else {
        const state = this.swingNodes.get(node);
        if (state) node.setLocalEulerAngles(state.base[0], state.base[1], state.base[2]);
        this.swingNodes.delete(node);
      }
    }
    if (!playing) {
      for (const node of collectSubtree(entity)) {
        const state = this.swingNodes.get(node);
        if (!state) continue;
        node.setLocalEulerAngles(state.base[0], state.base[1], state.base[2]);
        this.swingNodes.delete(node);
      }
    }
  }

  playNamedAnimation(clip: string, play: boolean, ownerNode?: string): void {
    const root = this.model?.root;
    const app = this.app;
    if (!root || !app) return;
    const entity = resolveClipEntity(clip, ownerNode, this) ?? root;
    const anim = (entity as unknown as { anim?: { assignAnimation?: (name: string, asset: unknown) => void; baseLayer?: { play?: (name: string) => void; stop?: () => void } }; animation?: { play?: (name: string) => void; stop?: () => void } });
    try {
      if (play) {
        anim.animation?.play?.(clip);
        anim.anim?.baseLayer?.play?.(clip);
      } else {
        anim.animation?.stop?.();
        anim.anim?.baseLayer?.stop?.();
      }
    } catch {
      /* 动画组件因模型导出差异可能不存在，旋转回退已覆盖风扇类动作 */
    }
    this.animationState.set(clip, { playing: play, kind: clip });
  }
'''
if old_tick not in text:
    raise SystemExit("tick/play block not found")
text = text.replace(old_tick, new_tick, 1)

helper = '''

function resolveClipEntity(clip: string, ownerNode: string | undefined, engine: EngineManager): Entity | undefined {
  if (ownerNode) {
    const owned = engine.findEntity(ownerNode);
    if (owned) return owned;
  }
  const byName = engine.model?.byName;
  if (!byName) return engine.model?.root;
  const exact = byName.get(clip);
  if (exact) return exact;
  const parts = clip.split("_");
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const key = parts.slice(0, i).join("_");
    const found = byName.get(key);
    if (found) return found;
  }
  return engine.model?.root;
}
'''
if "function resolveClipEntity" not in text:
    text = text.rstrip() + helper + "\n"
p.write_text(text)
print("patched EngineManager.ts")
