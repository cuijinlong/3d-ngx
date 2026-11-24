/**
 * 显示名解析（2026-11-23，对应 `docs/PRODUCT-CHARTER.md` 的命名铁律）。
 *
 * <h2>为什么必须有这一个文件</h2>
 *
 * <p>ThingsBoard 的 `name` 是**唯一键**，同一租户下不能重名。为了唯一，
 * 名字里被塞进型号和场站后缀：
 *
 * ```
 * name  PowerMeter-3P-CHINT·平台演示中心    ← 给平台用
 * label 正泰三相电表 DTSD3366D              ← 给人看
 * ```
 *
 * <p>客户原话：「所有你看平台的设备的技术名都很长、但是对用户不友好，
 * 你要用 label 来给客户看，包括标准 key 也要用中文。」
 *
 * <h2>为什么要收敛成一个函数</h2>
 *
 * <p>改之前前端散落着 `device.label || device.name` 这种写法，
 * 每处都靠人记得写 `|| name`。**漏一处就露出技术名，而且不报错** ——
 * 只能靠人盯着屏幕发现。收敛成一个入口后，新增显示位置只需检查
 * 「有没有走这里」，评审和 grep 都能查。
 *
 * <h2>规则</h2>
 *
 * <ul>
 *   <li>显示层 → {@link displayNameOf}（label 优先，回落 name）</li>
 *   <li>标识层（绑定/接口/存储/日志）→ **不要用这里**，直接用 `name` 或 `id`</li>
 *   <li>遥测/属性 key → {@link displayKeyOf}（场景配置的中文名优先）</li>
 * </ul>
 */

/** 带 label / name 的最小明实体（设备、资产都符合） */
export interface NamedEntity {
  name?: string | null;
  label?: string | null;
}

/**
 * 给人看的名字。
 *
 * <p>顺序：`label` → `name` → `fallback`。
 *
 * <p>`label` 为空字符串时也算空 —— 平台允许 label 是 `""`，
 * 直接用 `||` 会跳过它是对的，但用 `??` 会显示空白。
 */
export function displayNameOf(entity: NamedEntity | null | undefined, fallback = ""): string {
  if (!entity) return fallback;
  const label = entity.label?.trim();
  if (label) return label;
  const name = entity.name?.trim();
  if (name) return name;
  return fallback;
}

/**
 * 技术名的**短写** —— 仅用于「必须显示技术名但空间不够」的场合
 * （如日志、调试面板、绑定回退）。
 *
 * <p>砍掉 `·场站后缀`：`PowerMeter-3P-CHINT·平台演示中心` → `PowerMeter-3P-CHINT`。
 * **不要用在客户界面上** —— 客户要的是 label。
 */
export function shortTechnicalName(entity: NamedEntity | null | undefined): string {
  const raw = entity?.name?.trim() ?? "";
  if (!raw) return "";
  const idx = raw.indexOf("·");
  return idx > 0 ? raw.slice(0, idx) : raw;
}

/**
 * 遥测/属性 key 的中文名。
 *
 * <h2>三种来源，优先级从高到低</h2>
 *
 * <ol>
 *   <li>{@code labels} —— 场景实例层（`scene-widgets` 的 `slots[].label`
 *       或数据字典）。同一个 `temperature` 在冷热站叫「出水温度」、
 *       在机房叫「回风温度」，**必须允许按场景改名**。</li>
 *   <li>{@code fallback} —— 调用方给的补充字典（如部件内建的少量通用词）。</li>
 *   <li>技术 key 本身 —— 并且**要能看出它是技术名**，不要伪装成中文。</li>
 * </ol>
 *
 * <h2>为什么不做成全局硬编码字典</h2>
 *
 * <p>`if (key === 'temperature') return '温度'` 换个客户、换套设备就全错。
 * 中文名的权威来源是**场景配置**，不是代码。
 *
 * @param key         技术 key，如 `temperature`
 * @param labels      场景层的中文名映射
 * @param fallback    代码内建的通用名（可选）
 */
export function displayKeyOf(
  key: string | null | undefined,
  labels?: Record<string, string> | null,
  fallback?: Record<string, string> | null,
): string {
  if (!key) return "";
  const fromScene = labels?.[key]?.trim();
  if (fromScene) return fromScene;
  const fromFallback = fallback?.[key]?.trim();
  if (fromFallback) return fromFallback;
  /*
   * 回落到技术 key 时不做任何美化 —— 让它在界面上"看起来像技术名"，
   * 反而更容易被发现并补上中文。
   * 悄悄把下划线换成空格那种"美化"会让人以为已经翻译过了。
   */
  return key;
}
