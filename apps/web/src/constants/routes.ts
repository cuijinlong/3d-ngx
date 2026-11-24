export const routes = {
  root: "/",
  login: "/login",
  dashboard: "/dashboard",
  selectCustomer: "/customers",
  /** 模板库（仅租户）：保存模型 + 风格套装，供新建场景时实例化 */
  templates: "/templates",
  customerScenes: (customerId: string) => `/customers/${customerId}/scenes`,
  runtime: "/runtime",
  studioScenes: "/studio/scenes",
  studioEditor: (id: string) => `/studio/editor/${id}`,
  studioAssets: "/studio/assets",
  twinScenes: "/digital-twin/scenes",
  twinRuntime: (id: string) => `/digital-twin/runtime/${id}`,
  devices: "/devices/list",
  deviceDetail: (id: string) => `/devices/${id}`,
  settings: "/settings",
} as const;

/** 已从侧栏拿掉的入口。旧地址不再进原页面，登录后转到当前客户范围（有客户则进该客户场景管理，否则进选客户）。 */
export const RETIRED_APP_PATHS = [
  routes.dashboard,
  routes.devices,
  routes.deviceDetail(":deviceId"),
  routes.twinScenes,
  routes.studioAssets,
] as const;
