
/** 演示用设备类型模板。真实绑定字段仍以 GLB 解析结果为准，这里只给“新建模拟设备”一个起点。 */
export interface MockProfile {
  type: string;
  label: string;
  points: Array<{
    key: string;
    label: string;
    unit?: string;
    displayType: "number" | "boolean" | "text";
    min?: number;
    max?: number;
    base?: number;
    textValues?: string[];
  }>;
}

export const MOCK_PROFILES: MockProfile[] = [
  {
    type: "transformer",
    label: "变压器",
    points: [
      { key: "voltage", label: "电压", unit: "V", displayType: "number", min: 380, max: 420, base: 400 },
      { key: "current", label: "电流", unit: "A", displayType: "number", min: 10, max: 80, base: 35 },
      { key: "load", label: "负载率", unit: "%", displayType: "number", min: 20, max: 95, base: 55 },
      { key: "temperature", label: "温度", unit: "℃", displayType: "number", min: 28, max: 85, base: 45 },
    ],
  },
  {
    type: "meter",
    label: "电表",
    points: [
      { key: "voltage", label: "电压", unit: "V", displayType: "number", min: 210, max: 240, base: 220 },
      { key: "current", label: "电流", unit: "A", displayType: "number", min: 1, max: 40, base: 12 },
      { key: "power", label: "有功功率", unit: "kW", displayType: "number", min: 0.5, max: 30, base: 8 },
      { key: "pf", label: "功率因数", displayType: "number", min: 0.8, max: 1, base: 0.95 },
    ],
  },
  {
    type: "pump",
    label: "水泵",
    points: [
      { key: "running", label: "运行状态", displayType: "text", textValues: ["运行", "停止"] },
      { key: "frequency", label: "频率", unit: "Hz", displayType: "number", min: 20, max: 50, base: 45 },
      { key: "power", label: "功率", unit: "kW", displayType: "number", min: 2, max: 18, base: 8 },
    ],
  },
  {
    type: "compressor",
    label: "空压机",
    points: [
      { key: "running", label: "运行状态", displayType: "text", textValues: ["运行", "停止"] },
      { key: "pressure", label: "压力", unit: "MPa", displayType: "number", min: 0.4, max: 0.9, base: 0.7 },
      { key: "temperature", label: "温度", unit: "℃", displayType: "number", min: 35, max: 90, base: 55 },
      { key: "power", label: "功率", unit: "kW", displayType: "number", min: 5, max: 40, base: 18 },
    ],
  },
  {
    type: "generic",
    label: "通用设备",
    points: [],
  },
];

export function profileByType(type: string): MockProfile {
  return MOCK_PROFILES.find((p) => p.type === type) ?? MOCK_PROFILES[MOCK_PROFILES.length - 1]!;
}
