import { useEffect, useState } from "react";
import { loadFaultCodes } from "@idt/data-adapter";
import type { FaultCodeDictionary } from "@idt/data-adapter";

/**
 * 故障码诊断字典 hook（2026-11-23）。
 *
 * <h2>为什么是 hook 而不是直接调 `loadFaultCodes()`</h2>
 *
 * <p>模块级缓存已经保证只有一个请求，但组件仍然需要知道
 * 「现在拿到了没有」—— 拿到之前不能显示「无诊断依据」，
 * 那是在说「这个码查不到」，与「还没加载完」是两回事。
 *
 * <h2>为什么失败不抛错</h2>
 *
 * <p>诊断信息是**增强**。字典拉不到时告警列表、设备专题都必须照常可用，
 * 只是少了「为什么/怎么修」那一段。抛错会让整块面板白屏，
 * 为了一个辅助功能牺牲主功能，是本末倒置。
 */
export function useFaultCodes(enabled = true): {
  dictionary: FaultCodeDictionary | null;
  loading: boolean;
} {
  const [dictionary, setDictionary] = useState<FaultCodeDictionary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    void loadFaultCodes().then((result) => {
      /*
       * 组件可能已经卸载（快速切换选中设备时很常见）。
       * 不判 alive 会对已卸载组件 setState —— React 18 不报错但会浪费渲染。
       */
      if (!alive) return;
      setDictionary(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { dictionary, loading };
}
