import { useEffect, useState } from "react";
import styles from "./RuntimeShell.module.css";

/**
 * 大屏顶栏的「时钟 + 天气位」（2026-11-23）。
 *
 * <h2>为什么要有</h2>
 *
 * `template01` 的 header 右上角是 `☀ 22℃ 晴　2026.11.23 03:10`。
 * 这一块不只是装饰：现场值班时，「屏幕上这个数是什么时候的」是第一个问题。
 *
 * <h2>只显示真实的部分</h2>
 *
 * 时间是**真的**（每秒刷新）。天气我们拿不到真实数据，
 * 所以**不显示气温**——写一个假的 `22℃ 晴` 看起来和模板一样，
 * 但值班员会当成实测天气，那是在骗人。等接了气象源再加。
 */
export function RuntimeClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    /*
     * 对齐到整秒再起跳：直接 setInterval(1000) 会让秒数在高负载下慢慢漂移
     * （回调排队），几分钟后就和系统时间差一截。
     */
    let timer = 0;
    const schedule = () => {
      const delay = 1000 - (Date.now() % 1000);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <span className={styles.clock} data-testid="runtime-clock" title="当前时间（每秒刷新）">
      {date}
      <span className={styles.clockTime}>{time}</span>
    </span>
  );
}
