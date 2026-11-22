
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";
import type { DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import type { SceneWidget } from "@idt/data-adapter";
import { useAppTheme } from "../../theme/AppThemeProvider";
import type { TelemetryPoint } from "../../stores/telemetry.store";
import { formatTelemetryText } from "../../utils/device-plates";
import {
  readSlotValue,
  selectionBindings,
  summarizeSceneBindings,
} from "./widget-values";
import styles from "./WidgetOverlay.module.css";

function Empty({ children }: { children: string }) {
  return <div className={styles.empty}>{children}</div>;
}

function DemoMark({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className={styles.demo}>演示</span>;
}

export function MetricCardBody({
  widget,
  bindings,
  latest,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
}) {
  const slot = widget.slots?.[0];
  if (!slot) return <Empty>还没有绑定测点</Empty>;
  const reading = readSlotValue(slot, bindings, latest);
  if (!reading.bound) return <Empty>还没有绑定测点</Empty>;
  if (reading.missing) return <Empty>暂无数据</Empty>;
  return (
    <div className={styles.metricValue}>
      <span>{reading.text}</span>
      {reading.unit ? <small className={styles.metricUnit}>{reading.unit}</small> : null}
    </div>
  );
}

export function SummaryCardBody({
  bindings,
  latest,
}: {
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
}) {
  const summary = summarizeSceneBindings(bindings, latest);
  if (!summary.boundCount) return <Empty>还没有已绑定的设备</Empty>;
  return (
    <div className={styles.rows}>
      <div className={styles.row}><span>已绑定设备</span><b>{summary.boundCount}</b></div>
      <div className={styles.row}><span>有实时数据</span><b>{summary.withDataCount}</b></div>
      {summary.unknownCount === summary.boundCount ? (
        <div className={styles.row}><span className={styles.muted}>运行状态暂无数据</span></div>
      ) : (
        <>
          <div className={styles.row}><span>运行中</span><b>{summary.runningCount}</b></div>
          <div className={styles.row}><span>已停止</span><b>{summary.stoppedCount}</b></div>
        </>
      )}
    </div>
  );
}

export function SelectionCardBody({
  selectedNode,
  selectedEntityId,
  bindings,
  latest,
}: {
  selectedNode?: string | null;
  selectedEntityId?: string | null;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
}) {
  const list = selectionBindings([selectedNode, selectedEntityId], bindings);
  if (!selectedNode && !selectedEntityId) return <Empty>未选中对象</Empty>;
  if (!list.length) return <Empty>该对象还没有绑定测点</Empty>;
  const rows = list.flatMap((binding) =>
    binding.telemetryMappings.map((mapping) => {
      const row = latest[`${binding.deviceId}:${mapping.telemetryKey}`] ?? latest[`${binding.deviceId}:${mapping.field}`];
      return {
        key: `${binding.id}-${mapping.telemetryKey || mapping.field}`,
        label: mapping.label || mapping.telemetryKey,
        text: row ? formatTelemetryText(row.value, mapping.displayType, mapping.unit || row.unit) : "",
        missing: !row,
        demo: row?.source === "mock",
      };
    }),
  );
  if (!rows.length) return <Empty>该对象还没有绑定测点</Empty>;
  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <div className={styles.row} key={row.key}>
          <span>{row.label}</span>
          <b className={row.missing ? styles.muted : undefined}>{row.missing ? "暂无数据" : row.text}</b>
        </div>
      ))}
    </div>
  );
}

function useChartTokens() {
  const { theme } = useAppTheme();
  const [tokens, setTokens] = useState({ text: "", muted: "", border: "", primary: "" });
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setTokens({
      text: style.getPropertyValue("--ngx-color-text").trim(),
      muted: style.getPropertyValue("--ngx-color-muted").trim(),
      border: style.getPropertyValue("--ngx-color-border").trim(),
      primary: style.getPropertyValue("--ngx-color-primary").trim(),
    });
  }, [theme]);
  return tokens;
}

export function TrendCardBody({
  widget,
  bindings,
  latest,
  history,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  history: Record<string, TelemetryPoint[]>;
}) {
  const tokens = useChartTokens();
  const slots = widget.slots?.length ? widget.slots : [];
  const series = useMemo(() => {
    return slots.map((slot) => {
      const reading = readSlotValue(slot, bindings, latest);
      const bindingDevice = slot.deviceId || bindings.find((item) => item.sceneEntityId === slot.sceneEntityId)?.deviceId;
      const keys = [slot.telemetryKey, slot.key].filter(Boolean) as string[];
      const points = keys.flatMap((key) => (bindingDevice ? history[`${bindingDevice}:${key}`] ?? [] : []));
      return {
        name: slot.label || slot.telemetryKey || slot.key,
        type: "line" as const,
        showSymbol: false,
        data: points.map((point) => [point.timestamp, point.value] as const),
        bound: reading.bound,
      };
    });
  }, [slots, bindings, latest, history]);

  if (!slots.length) return <Empty>还没有绑定测点</Empty>;
  if (series.every((item) => !item.bound)) return <Empty>还没有绑定测点</Empty>;
  if (series.every((item) => item.data.length < 2)) return <Empty>暂无历史数据</Empty>;

  return (
    <ReactECharts
      className={styles.chart}
      style={{ height: "100%", width: "100%" }}
      option={{
        animation: false,
        color: [tokens.primary],
        tooltip: { trigger: "axis" },
        grid: { left: 28, right: 8, top: 16, bottom: 20 },
        xAxis: {
          type: "time",
          axisLabel: { color: tokens.muted, fontSize: 10 },
          axisLine: { lineStyle: { color: tokens.border } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: tokens.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: tokens.border, opacity: 0.6 } },
        },
        series: series.filter((item) => item.data.length),
      }}
    />
  );
}

export function TitleCardBody({ widget, fallback }: { widget: SceneWidget; fallback?: string }) {
  const text = widget.title?.trim() || fallback?.trim() || "";
  if (!text) return <Empty>还没有填写标题</Empty>;
  return (
    <>
      <h1 className={styles.titleText}>{text}</h1>
      <hr className={styles.titleRule} />
    </>
  );
}

export function CaptionCardBody({ widget }: { widget: SceneWidget }) {
  const text = widget.title?.trim() || "";
  if (!text) return <Empty>还没有填写说明</Empty>;
  return <div className={styles.captionText}>{text}</div>;
}

export function widgetHeading(widget: SceneWidget, fallbackTitle?: string) {
  if (widget.type === "title" || widget.type === "caption") return "";
  return widget.title?.trim() || fallbackTitle || "";
}

export { DemoMark };
