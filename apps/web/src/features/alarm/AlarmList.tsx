import { List, Tag } from "antd";
import { getProviderKind } from "@idt/data-adapter";
import { useTelemetryStore } from "../../stores/telemetry.store";

export function AlarmList({ compact = false }: { compact?: boolean }) {
  const alarms = useTelemetryStore((s) => s.alarms);
  const demo = getProviderKind() === "mock";
  return (
    <div style={{ padding: compact ? "8px 0 0" : 12 }} data-testid="alarm-list">
      <div style={{ marginBottom: 8, fontWeight: 650 }}>
        告警 {demo ? <span className="idt-demo-tag">演示数据</span> : null}
      </div>
      <List
        size="small"
        dataSource={alarms}
        locale={{ emptyText: "当前没有告警" }}
        renderItem={(item) => (
          <List.Item>
            <div>
              <Tag color={item.level === "alarm" ? "red" : "orange"}>{item.level === "alarm" ? "告警" : "预警"}</Tag>
              {item.deviceName} · {item.message}
            </div>
          </List.Item>
        )}
      />
    </div>
  );
}
