import { Alert } from "antd";
import type { FaultCodeEntry } from "@idt/data-adapter";

/**
 * 故障诊断展示（2026-11-23）。
 *
 * <h2>为什么做成共享组件</h2>
 *
 * <p>告警面板和设备专题都要显示「这条故障是什么、为什么、怎么修」。
 * 各写一份必然漂移 —— 一边显示解决方案、另一边忘了，或者措辞不一致。
 * 用户在不同页面看到同一故障的两种说法，就不敢信任何一个。
 *
 * <h2>为什么分三段显示</h2>
 *
 * <ul>
 *   <li><b>描述</b>（`desc`）—— 用户第一眼要知道「这是啥」；</li>
 *   <li><b>分析</b>（`analysis`）—— 为什么会出现，帮助判断是不是误报；</li>
 *   <li><b>解决方案</b>（`solution`）—— 该动手做什么。</li>
 * </ul>
 *
 * 三段都来自厂商官方手册，不是我们编的。`source` 用来标出处，
 * 现场对不上时能回溯到哪份文档哪一版。
 *
 * <h2>为什么不显示「无诊断依据」</h2>
 *
 * <p>`entries` 为空有两种可能：还没加载完、或这个码确实不在字典里。
 * 组件无法区分，所以**只在有内容时渲染**，无内容时什么都不画 ——
 * 静默不显示好过错误地宣称「查不到」。
 */
export function FaultDiagnosis({
  entries,
  compact = false,
}: {
  entries: FaultCodeEntry[];
  compact?: boolean;
}) {
  if (!entries.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
      {entries.map((entry) => (
        <Alert
          key={entry.codes.join(",")}
          type="warning"
          showIcon
          style={{ padding: compact ? "3px 8px" : "6px 10px" }}
          message={
            <span style={{ fontSize: compact ? 11 : 12, fontWeight: 600 }}>
              {entry.codes.length === 1 ? entry.codes[0] : entry.codes.join("/")} · {entry.desc}
            </span>
          }
          description={
            <div style={{ fontSize: compact ? 10.5 : 11.5, lineHeight: 1.55 }}>
              {entry.analysis ? (
                <div>
                  <b style={{ opacity: 0.75 }}>原因：</b>
                  {entry.analysis}
                </div>
              ) : null}
              {entry.solution ? (
                <div>
                  <b style={{ opacity: 0.75 }}>处理：</b>
                  {entry.solution}
                </div>
              ) : null}
              {/*
               * 出处只在有 space 时显示。compact 模式（大屏右翼）空间紧张，
               * 现场排障时更关心「怎么修」而不是「哪份手册」。
               */}
              {!compact && entry.source ? (
                <div style={{ marginTop: 2, opacity: 0.55, fontSize: 10 }}>
                  依据：{entry.source}
                </div>
              ) : null}
            </div>
          }
        />
      ))}
    </div>
  );
}
