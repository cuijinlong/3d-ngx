import type { ReactNode } from "react";
import { Button, Space } from "antd";
import type { TelemetryRecord } from "@idt/shared-types";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { RuntimeClock } from "./RuntimeClock";
import { RuntimeStatus } from "./RuntimeStatus";
import type { PlaceSource } from "./scene-place";
import styles from "./RuntimeShell.module.css";

export function RuntimeChrome(props: {
  crumbs?: ReactNode;
  title?: string;
  dataLabel?: string;
  showDataLabel?: boolean;
  showReturnToStudio?: boolean;
  onReturnToStudio?: () => void;
  showLogout?: boolean;
  onLogout?: () => void;
  showExitPreview?: boolean;
  onExitPreview?: () => void;
  showThemeToggle?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** 相机复位 + 聚焦运行汇总卡。原来在视口右下角，按模板布局移到顶栏。 */
  onOverview?: () => void;
  /** 天气行政区划（场站 → 组织 → 场景）。null = 没配置，不显示天气。 */
  weatherPlace?: string | null;
  /** 上面的地点来自哪一级，用于 title 提示 */
  weatherPlaceSource?: PlaceSource | null;
  /** 内存里的最新遥测表：取最大时间戳做「最新数据时间」 */
  latest?: Record<string, TelemetryRecord> | Map<string, TelemetryRecord> | null;
}) {
  return (
    <div className={styles.bar} data-testid="runtime-chrome">
      {/*
       * 品牌图标（2026-11-23）：对齐 template01 顶栏左侧那个发光菱形。
       * 纯装饰，不承载数据 —— 用 `aria-hidden` 让读屏器跳过。
       */}
      <div className={styles.brandMark} aria-hidden="true"><i /></div>
      <div className={styles.crumbs}>
        {props.crumbs ?? (props.title ? <b>{props.title}</b> : null)}
      </div>
      {props.showDataLabel && props.dataLabel ? <span className="idt-demo-tag">{props.dataLabel}</span> : null}
      <span className={styles.grow} />
      {/*
       * 天气 + 最新数据时间（2026-11-24 客户要求）。
       * 天气拿不到就不渲染那一块（见 `useWeather`），不给假数据；
       * 数据时间一条遥测都没收到时显示「暂无数据」。
       */}
      <RuntimeStatus
        place={props.weatherPlace ?? null}
        placeSource={props.weatherPlaceSource ?? null}
        latest={props.latest}
      />
      {/* 实时时钟：对齐 template01 header 右上角（不带天气，没有数据源就不编） */}
      <RuntimeClock />
      {props.showThemeToggle ? <ThemeToggle /> : null}
      <Space>
        {props.showExitPreview ? (
          <Button type="primary" data-testid="exit-preview" onClick={props.onExitPreview}>
            退出预览
          </Button>
        ) : null}
        {props.showReturnToStudio ? (
          <Button onClick={props.onReturnToStudio}>返回场景管理</Button>
        ) : null}
        {props.onOverview ? (
          <Button data-testid="camera-overview" onClick={props.onOverview}>视角复位</Button>
        ) : null}
        {props.onToggleFullscreen ? (
          <Button onClick={props.onToggleFullscreen}>{props.fullscreen ? "退出全屏布局" : "全屏展示"}</Button>
        ) : null}
        <Button onClick={() => void window.document.documentElement.requestFullscreen?.()}>浏览器全屏</Button>
        {props.showLogout ? (
          <Button onClick={props.onLogout}>退出</Button>
        ) : null}
      </Space>
    </div>
  );
}
