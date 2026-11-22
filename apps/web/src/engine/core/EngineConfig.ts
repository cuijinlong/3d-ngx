
export const DEFAULT_ENGINE_CONFIG = {
  /** 浅色工业纸面，贴近场内对照图，而不是纯白曝光 */
  clearColor: "#eef2f6",
  ambient: "#b7c1cd",
  cameraPosition: [22, 18, 26] as [number, number, number],
  /** 更接近对照图的等轴感，减小透视拉伸 */
  fov: 32,
  /** 稍高、稍远的整排总览，贴近场内对照图机位 */
  cameraAzimuthDeg: 58,
  cameraElevationDeg: 48,
  /** 多留一点四周余量，避免裁掉整排设备 */
  fitDistanceFactor: 1.85,
  exposure: 1.02,
  gridSize: 40,
  gridStep: 1,
};
