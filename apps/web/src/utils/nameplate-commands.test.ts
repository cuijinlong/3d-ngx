
import { describe, expect, it } from "vitest";
import type { CommandDef } from "@idt/shared-types";
import { matchNameplateCommand } from "./nameplate-commands";

const setRunning: CommandDef = { id: "setRunning", label: "启停", params: [{ name: "running", type: "boolean" }], hasRequiredParams: true };
const start: CommandDef = { id: "start", label: "远程启动" };
const stop: CommandDef = { id: "stop", label: "远程停止" };

describe("matchNameplateCommand", () => {
  it("丢掉带必填参数的「启停」，命中无参数的远程启动/停止", () => {
    const commands = [setRunning, start, stop];
    expect(matchNameplateCommand("start", commands)).toEqual({ ok: true, command: start });
    expect(matchNameplateCommand("stop", commands)).toEqual({ ok: true, command: stop });
  });

  it("不要仅因含「启」就命中「启停」", () => {
    expect(matchNameplateCommand("start", [setRunning])).toEqual({ ok: false, reason: "no-match" });
    expect(matchNameplateCommand("start", [{ id: "setRunning", label: "启停" }])).toEqual({ ok: false, reason: "no-match" });
  });

  it("英文 id 大小写不敏感地等于 start/stop 也可命中", () => {
    const commands: CommandDef[] = [{ id: "START", label: "开机" }, { id: "STOP", label: "关机" }];
    expect(matchNameplateCommand("start", commands)).toEqual({ ok: true, command: commands[0] });
    expect(matchNameplateCommand("stop", commands)).toEqual({ ok: true, command: commands[1] });
  });

  it("多条时优先 id 恰好为 start/stop，再不行取更短且 id 不含冒号的", () => {
    const remote: CommandDef = { id: "start:unit", label: "远程启动" };
    const plain: CommandDef = { id: "start", label: "远程启动" };
    expect(matchNameplateCommand("start", [remote, plain])).toEqual({ ok: true, command: plain });
    const short: CommandDef = { id: "boot", label: "启动" };
    const longer: CommandDef = { id: "remote-boot", label: "远程启动" };
    expect(matchNameplateCommand("start", [longer, short])).toEqual({ ok: true, command: short });
  });

  it("仍分不出时当作匹配失败", () => {
    const a: CommandDef = { id: "alpha", label: "启动甲" };
    const b: CommandDef = { id: "beta", label: "启动乙" };
    expect(matchNameplateCommand("start", [a, b])).toEqual({ ok: false, reason: "no-match" });
  });

  it("显式 optional 的参数不当作必填而丢掉", () => {
    const optionalStart: CommandDef = {
      id: "start",
      label: "远程启动",
      params: [{ name: "note", type: "text", required: false }],
      hasRequiredParams: false,
    };
    expect(matchNameplateCommand("start", [optionalStart])).toEqual({ ok: true, command: optionalStart });
  });
});
