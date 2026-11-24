import styles from "./ViewportFrame.module.css";

export function ViewportFrame({ variant }: { variant: "edit" | "hud" }) {
  return (
    <div
      className={`${styles.frame} ${variant === "hud" ? styles.frameHud : styles.frameEdit}`}
      data-testid="viewport-frame"
      data-variant={variant}
      aria-hidden
    >
      <span className={styles.corner} data-corner="tl" />
      <span className={styles.corner} data-corner="tr" />
      <span className={styles.corner} data-corner="bl" />
      <span className={styles.corner} data-corner="br" />
    </div>
  );
}
