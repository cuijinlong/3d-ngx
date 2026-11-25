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
export function useFaultCodes(
  enabled = true,
  /**
   * 已知设备时传它，只拉该设备型号的故障码（2026-11-24）。
   *
   * <p>**告警列表不要传**：它一次显示多台设备的告警，只拉一个型号的码
   * 会让其它型号的告警翻不出说明 —— 而这种缺失是静默的，
   * 只表现为「有些告警没有解释」。
   *
   * <p>告警详情弹层可以传（`alarm.deviceId` 一定存在），
   * 后端定位不到型号时会自动退回全量，所以不会更少。
   */
  deviceId?: string,
): {
  dictionary: FaultCodeDictionary | null;
  loading: boolean;
} {
  const [dictionary, setDictionary] = useState<FaultCodeDictionary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    void loadFaultCodes(deviceId).then((result) => {
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
  }, [enabled, deviceId]);

  return { dictionary, loading };
}
