import { useEffect, useState } from "react";
import { loadMetricDiagnoses } from "@idt/data-adapter";
import type { MetricDiagnosisMap } from "@idt/data-adapter";

/**
 * 指标诊断依据 hook（2026-11-23）。
 *
 * <p>与 `useFaultCodes` 分开：故障码是「已知码 → 含义」的查表，
 * 这个是「指标 + 值 + 工况 → 是否异常」的判读。两者的数据源、
 * 刷新时机、消费方式都不同，合在一个 hook 里只会互相牵制。
 *
 * <p>失败不抛错：诊断是增强，设备专题少了它仍然要看得到参数值。
 */
export function useMetricDiagnoses(enabled = true): {
  byKey: MetricDiagnosisMap | null;
  loading: boolean;
} {
  const [byKey, setByKey] = useState<MetricDiagnosisMap | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    void loadMetricDiagnoses().then((result) => {
      if (!alive) return;
      setByKey(result.byKey);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { byKey, loading };
}
