
import { Button, InputNumber, Space, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { useMemo } from "react";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";

export function SceneTree() {
  const document = useSceneStore((s) => s.document);
  const removeEntity = useSceneStore((s) => s.removeEntity);
  const selected = useSelectionStore((s) => s.entityId);
  const select = useSelectionStore((s) => s.select);

  const tree = useMemo<DataNode[]>(() => {
    const entities = document?.entities ?? [];
    return [
      {
        title: document?.scene.name ?? "场景",
        key: "root",
        children: entities.map((e) => ({
          title: e.name,
          key: e.id,
        })),
      },
    ];
  }, [document]);

  const current = document?.entities.find((e) => e.id === selected);

  return (
    <div style={{ padding: 8 }}>
      <Tree
        treeData={tree}
        defaultExpandAll
        selectedKeys={selected ? [selected] : []}
        onSelect={(keys) => {
          const id = String(keys[0] ?? "");
          if (id === "root" || !id) {
            select(null, null);
            return;
          }
          const entity = document?.entities.find((e) => e.id === id);
          select(id, entity?.nodeName ?? id);
        }}
      />
      {current ? (
        <Space style={{ marginTop: 8 }}>
          <Button size="small" danger onClick={() => { removeEntity(current.id); select(null, null); }}>
            删除
          </Button>
        </Space>
      ) : null}
    </div>
  );
}

void InputNumber;
