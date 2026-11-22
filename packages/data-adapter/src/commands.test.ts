import { describe, expect, it } from "vitest";
import { GuardHttpError } from "./guard-client";
import {
  commandHasRequiredParams,
  describeCommandError,
  parseCommands,
  RealtimeDeviceError,
} from "./commands";

describe("parseCommands", () => {
  it("parses string arrays", () => {
    const cmds = parseCommands(["start", "stop"]);
    expect(cmds.map((c) => c.id)).toEqual(["start", "stop"]);
    expect(cmds[0]?.label).toBe("start");
    expect(cmds[0]?.name).toBe("start");
    expect(cmds[0]?.hasRequiredParams).toBe(false);
  });

  it("parses object arrays and marks required params by default", () => {
    const cmds = parseCommands(
      JSON.stringify([
        { id: "setRunning", label: "启停", params: [{ name: "value", type: "boolean" }] },
        { id: "start", label: "远程启动" },
        { id: "stop", name: "远程停止" },
      ]),
    );
    expect(cmds[0]).toMatchObject({
      id: "setRunning",
      label: "启停",
      name: "启停",
      hasRequiredParams: true,
    });
    expect(cmds[0]?.params?.[0]).toEqual({ name: "value", type: "boolean", required: true });
    expect(commandHasRequiredParams(cmds[0]!)).toBe(true);
    expect(cmds[1]).toMatchObject({ id: "start", label: "远程启动", name: "远程启动", hasRequiredParams: false });
    expect(cmds[2]).toMatchObject({ id: "stop", label: "远程停止", name: "远程停止", hasRequiredParams: false });
  });

  it("does not parse rpcCommands-shaped objects", () => {
    expect(parseCommands({ methods: [{ method: "start", params: {}, desc: "x" }] })).toEqual([]);
  });

  it("treats explicit required false as optional", () => {
    const cmds = parseCommands([
      { id: "start", label: "启动", params: [{ name: "note", type: "text", required: false }] },
    ]);
    expect(cmds[0]?.hasRequiredParams).toBe(false);
    expect(cmds[0]?.params?.[0]?.required).toBe(false);
  });
});

describe("describeCommandError", () => {
  it("maps 504 to 请求超时", () => {
    expect(describeCommandError(new GuardHttpError("请求失败 504", 504))).toEqual({
      status: 504,
      message: "请求超时",
    });
  });

  it("keeps virtual-device refusal", () => {
    expect(describeCommandError(new RealtimeDeviceError("virtual")).message).toBe("绑定已失效（虚拟设备）");
  });
});
