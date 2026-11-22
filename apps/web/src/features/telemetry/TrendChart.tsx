import ReactECharts from "echarts-for-react";
import { getMockController, getProviderKind } from "@idt/data-adapter";

function readHistory(deviceId: string, key: string) {
  if (getProviderKind() !== "mock") return [];
  try {
    return getMockController()
      .getHistory(deviceId, key, 40)
      .map((r) => [r.timestamp, typeof r.value === "number" ? r.value : Number(r.value) || 0] as const);
  } catch {
    return [];
  }
}

export function TrendChart({ deviceId, keys }: { deviceId: string; keys: string[] }) {
  const series = keys.slice(0, 3).map((key) => ({
    name: key,
    type: "line" as const,
    showSymbol: false,
    data: readHistory(deviceId, key),
  }));
  if (series.every((item) => item.data.length < 2)) {
    return <div style={{ marginTop: 8, color: "var(--idt-muted)", fontSize: 12 }}>暂无历史数据</div>;
  }
  return (
    <ReactECharts
      style={{ height: 180, marginTop: 8 }}
      option={{
        animation: false,
        tooltip: { trigger: "axis" },
        legend: { data: series.map((s) => s.name), textStyle: { fontSize: 10 } },
        grid: { left: 32, right: 12, top: 28, bottom: 24 },
        xAxis: { type: "time" },
        yAxis: { type: "value" },
        series,
      }}
    />
  );
}
