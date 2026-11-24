import { Button, List, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { getDataProvider, getProviderKind, lookupFaultCodes } from "@idt/data-adapter";
import type { AlarmRecord } from "@idt/shared-types";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { useFaultCodes } from "../../hooks/useFaultCodes";
import { FaultDiagnosis } from "../diagnosis/FaultDiagnosis";

/**
 * 告警列表 + 处置（2026-11-23）。
 *
 * <h2>为什么只有「确认」和「清除」，没有「规则配置」</h2>
 *
 * <p>3d-ngx 是数据孪生**呈现与处置**端，不承担告警规则的定义 ——
 * 规则在平台侧（阈值、严重度、触发条件）。这里只做两件事：
 *
 * <ol>
 *   <li><b>接收</b>：把平台活跃告警显示出来；</li>
 *   <li><b>下发处置</b>：确认（我看到了）/ 清除（问题解决了）。</li>
 * </ol>
 *
 * <h2>为什么「确认」和「清除」必须是两个按钮</h2>
 *
 * <p>合成一个「处理」会让「谁在跟进」无从追溯。真实流程是：
 * 先认领避免多人重复处理，修好后再关闭。
 * 所以未确认时先给「确认」，确认后才给「清除」。
 *
 * <h2>处置后为什么要立即刷新</h2>
 *
 * <p>轮询是 60 秒一次。用户点完按钮看不到变化，会以为没生效、再点一次 ——
 * 所以处置成功后立刻调 `refreshAlarms()`。
 */
export function AlarmList({ compact = false }: { compact?: boolean }) {
  const alarms = useTelemetryStore((s) => s.alarms);
  const refreshAlarms = useTelemetryStore((s) => s.refreshAlarms);
  const demo = getProviderKind() === "mock";
  /** 正在处置的告警 id —— 按条禁用按钮，避免连点。 */
  const [busy, setBusy] = useState<string | null>(null);

  const provider = getDataProvider();
  const canAck = Boolean(provider.ackAlarm);
  const canClear = Boolean(provider.clearAlarm);

  /*
   * 故障码字典（2026-11-23）。
   *
   * <p>告警只告诉我们「发生了什么」（TH702），现场真正要回答的是
   * 「为什么会这样、该查什么」—— 那个答案在厂商手册里，现在进了字典。
   * 字典拉不到时 `lookupFaultCodes` 返回空数组，告警列表照常可用。
   */
  const { dictionary } = useFaultCodes();

  /*
   * 挂载时主动拉一次（2026-11-23）。
   *
   * <p>store 里的告警靠 `useTelemetryFeed` 60 秒轮询填充 —— 打开面板时
   * 可能还没到第一轮，于是显示「当前没有告警」而平台明明有。
   * 打开面板是最需要看到告警的时刻，不能等。
   */
  useEffect(() => {
    void refreshAlarms();
  }, [refreshAlarms]);

  const handle = async (alarm: AlarmRecord, action: "ack" | "clear") => {
    setBusy(alarm.id);
    try {
      /*
       * 用 provider 的可选方法，缺失时明确说「当前数据源不支持」——
       * 而不是静默什么都不做（mock 就没有这两个方法）。
       */
      if (action === "ack") {
        if (!provider.ackAlarm) {
          message.warning("当前数据源不支持确认告警");
          return;
        }
        await provider.ackAlarm(alarm.id);
        message.success("已确认");
      } else {
        if (!provider.clearAlarm) {
          message.warning("当前数据源不支持清除告警");
          return;
        }
        await provider.clearAlarm(alarm.id);
        message.success("已清除");
      }
      await refreshAlarms();
    } catch (error) {
      /*
       * 把平台的原话带出来。最常见的是「Alarm with id [...] is not found」——
       * 说明这条已经被别人处置了，刷新一下就好，不是系统坏了。
       */
      message.error(error instanceof Error ? error.message : String(error));
      await refreshAlarms();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: compact ? "8px 0 0" : 12 }} data-testid="alarm-list">
      <div style={{ marginBottom: 8, fontWeight: 650 }}>
        告警 {demo ? <span className="idt-demo-tag">演示数据</span> : null}
      </div>
      <List
        size="small"
        dataSource={alarms}
        locale={{ emptyText: "当前没有告警" }}
        renderItem={(item) => {
          /*
           * 从告警文本里抽故障码再查字典（2026-11-23）。
           *
           * <p>为什么要从文本抽，不要求平台给结构化的码：
           * TB 告警是原生结构（type/severity/details），故障码通常被拼进
           * 标题或消息里（「模块机 1# 报警 TH702」）。我们没有权限改平台的
           * 告警写入格式，也不该要求现场按某个格式配规则。
           */
          const diagnosis = lookupFaultCodes(dictionary, `${item.message} ${item.deviceName}`);
          return (
          <List.Item
            actions={[
              <Button
                key="ack"
                size="small"
                type="link"
                data-testid={`alarm-ack-${item.id}`}
                disabled={!canAck || Boolean(item.acknowledged) || busy === item.id}
                onClick={() => void handle(item, "ack")}
              >
                {item.acknowledged ? "已确认" : "确认"}
              </Button>,
              <Button
                key="clear"
                size="small"
                type="link"
                danger
                data-testid={`alarm-clear-${item.id}`}
                disabled={!canClear || busy === item.id}
                onClick={() => void handle(item, "clear")}
              >
                清除
              </Button>,
            ]}
          >
            <div style={{ width: "100%" }}>
              <div>
                <Tag color={item.level === "alarm" ? "red" : "orange"}>
                  {item.level === "alarm" ? "告警" : "预警"}
                </Tag>
                {/*
                 * 未确认的加个标记：大屏上「几十条告警」里，
                 * 真正需要动手的是没确认过的那几条。
                 */}
                {item.acknowledged === false ? <Tag>待确认</Tag> : null}
                {item.deviceName} · {item.message}
              </div>
              {/*
               * 诊断依据（2026-11-23）。
               *
               * <p>只有真命中字典才画 —— 没命中时不显示任何东西，
               * 否则每条告警下面都挂一行「无诊断依据」，比不显示更吵。
               */}
              {diagnosis.length ? (
                <div style={{ marginTop: 4 }} data-testid={`alarm-diagnosis-${item.id}`}>
                  <FaultDiagnosis entries={diagnosis} compact />
                </div>
              ) : null}
            </div>
          </List.Item>
          );
        }}
      />
    </div>
  );
}
