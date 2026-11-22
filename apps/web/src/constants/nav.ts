
import { routes } from "./routes";

/** 侧栏只留设置；租户从选客户进入该客户的场景管理，不再提供无客户范围的工作室列表。 */
export const APP_NAV_ITEMS = [
  { to: routes.settings, label: "设置" },
] as const;
