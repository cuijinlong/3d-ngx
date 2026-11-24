import { Button, Popconfirm, Tag, message } from "antd";
import { useEffect, useState } from "react";
import {
  commandHasRequiredParams,
  describeCommandError,
  getCommandProvider,
  getProviderKind,
} from "@idt/data-adapter";
import type { CommandDef } from "@idt/shared-types";

/**
 * 设备操作命令列表（2026-11-23）。
 *
 * <h2>为什么需要它</h2>
 *
 * <p>客户要求点击设备后「把设备维度相关的统计部件和**操作部件**抽屉出来」。
 * 设备专题卡原来只有「参数 + 趋势」—— 看得见状态，但动不了。
 * 要处置异常还得切回别的页面，等于把「发现 → 处理」这条链路断成两截。
 *
 * <h2>命令从哪来</h2>
 *
 * <p>从设备自己的 `rpcMethods` 读（`getCommandProvider().listCommands`），
 * **不在前端写死命令名**。换网关、换协议时只改设备属性，这里零改动 ——
 * 这是项目铁律「业务绑定不写进代码」的直接体现。
 *
 * <h2>★ 为什么带必填参数的命令只显示不执行</h2>
 *
 * <p>`setTemperature(45)` 这类命令需要参数，而抽屉里没有参数输入区。
 * 两个选择：现做一个表单，或者先只放无参命令（启停、复位）。
 *
 * <p>选后者：**参数输入是独立的交互设计问题**（数值范围、单位、校验、
 * 与设定点的联动），塞进抽屉会让「点开看一眼」变成「填一张表」。
 * 现在就做等于把没想清的东西硬塞进去。所以带参命令**显示但禁用**，
 * 并说明「需在控制条中配置」—— 用户至少知道有这个能力，也知道去哪用。
 *
 * <h2>A5：只查当前这一台</h2>
 *
 * <p>选中哪台查哪台，一次一个请求。不做「预取所有设备的命令」——
 * 14 台设备就是 14 个请求，而用户一次只看一台。
 */
export function DeviceCommandList({
  deviceId,
  deviceName,
}: {
  deviceId: string;
  deviceName?: string;
}) {
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const demo = getProviderKind() === "mock";

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setCommands([]);
    void getCommandProvider()
      .listCommands(deviceId)
      .then((list) => {
        /*
         * 组件可能在请求途中卸载（快速连点不同设备时很常见）。
         * 不判 alive 会对已卸载组件 setState —— 界面上会短暂闪出
         * **上一台设备**的命令，最危险的那种错：看着对，控错机。
         */
        if (!alive) return;
        setCommands(list ?? []);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [deviceId]);

  const run = async (command: CommandDef) => {
    setBusy(command.id);
    try {
      await getCommandProvider().sendCommand(deviceId, command.id);
      message.success(`已下发「${command.label}」`);
    } catch (err) {
      /*
       * 用 describeCommandError 而不是 String(err)：
       * 平台的 RPC 失败原因对现场没有意义（一堆 json），
       * 那个函数已经把它翻成了「设备离线 / 没有这条命令」这类人话。
       */
      /* describeCommandError 返回 { status?, message }，不是字符串 */
      message.error(describeCommandError(err).message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div style={HINT_STYLE}>读取可用命令…</div>;
  if (error) return <div style={HINT_STYLE}>命令不可用：{error}</div>;
  if (!commands.length) {
    return <div style={HINT_STYLE}>该设备未登记可执行命令</div>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {commands.map((command) => {
        const needsParams = commandHasRequiredParams(command);
        const button = (
          <Button
            key={command.id}
            size="small"
            /*
             * 无参命令直接可点；带参命令置灰但**不隐藏** ——
             * 用户需要知道「这台设备能设温度」，只是这里不能设。
             */
            disabled={needsParams || demo || busy === command.id}
            loading={busy === command.id}
            data-testid={`device-cmd-${command.id}`}
          >
            {command.label}
            {needsParams ? <Tag style={{ marginLeft: 4 }}>需参数</Tag> : null}
          </Button>
        );
        /*
         * 二次确认：启停这类操作误触代价是停机。
         * 带参命令已被禁用，不需要确认框。
         */
        if (needsParams || demo) return button;
        return (
          <Popconfirm
            key={command.id}
            title={`对「${deviceName ?? "该设备"}」执行 ${command.label}？`}
            okText="执行"
            cancelText="取消"
            onConfirm={() => void run(command)}
          >
            {button}
          </Popconfirm>
        );
      })}
      {demo ? (
        <div style={HINT_STYLE}>演示数据源不支持下发命令</div>
      ) : null}
    </div>
  );
}

/**
 * 提示文字的样式。
 *
 * <p>内联而不是建 CSS Module：这个组件只需要一种提示样式，
 * 为它单开一个 .module.css 反而增加「样式散落在多处」的维护成本。
 *
 * <p>颜色用 HUD 变量加降级值 —— 大屏上是暗色，编辑器里也能读。
 */
const HINT_STYLE = {
  fontSize: 10.5,
  lineHeight: 1.5,
  color: "var(--widget-muted, var(--ngx-color-muted))",
} as const;
