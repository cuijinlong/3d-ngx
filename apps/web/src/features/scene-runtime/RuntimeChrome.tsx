import type { ReactNode } from "react";
import { Button, Space } from "antd";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { RuntimeClock } from "./RuntimeClock";
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
