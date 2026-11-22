import { Button, Input, Popover } from "antd";
import { useMemo, useState } from "react";
import type { Device, ParsedHmiScene } from "@idt/shared-types";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import { useBindByName } from "../../hooks/useBindByName";

export function FindObjectPopover({
  hmi,
  devices,
  onPick,
}: {
  hmi: ParsedHmiScene | null;
  devices: Device[];
  onPick: (node: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { running, matchByName } = useBindByName(hmi, devices);
  const items = useMemo(() => (hmi ? uniqueEntitiesFromParsed(hmi) : []), [hmi]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q) || item.node.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      placement="bottomLeft"
      content={
        <div style={{ width: 280 }} data-testid="find-object-list">
          <Input
            autoFocus
            allowClear
            placeholder="查找画面对象"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
            {filtered.length === 0 ? (
              <div style={{ color: "var(--ngx-color-muted)", fontSize: 13, padding: "8px 0" }}>没有匹配的对象</div>
            ) : (
              filtered.map((item) => (
                <Button
                  key={item.node}
                  type="text"
                  block
                  style={{ textAlign: "left", height: 32 }}
                  onClick={() => {
                    onPick(item.node);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {item.name}
                </Button>
              ))
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--ngx-color-border)", marginTop: 8, paddingTop: 8 }}>
            <Button
              size="small"
              block
              data-bind-by-name="true"
              loading={running}
              onClick={() => void matchByName()}
            >
              按名称自动连接
            </Button>
            <div style={{ color: "var(--ngx-color-muted)", fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>
              按对象名称匹配实时设备，写入本地场景，不会改 GLB。
            </div>
          </div>
        </div>
      }
    >
      <Button data-testid="find-object">查找画面对象</Button>
    </Popover>
  );
}
