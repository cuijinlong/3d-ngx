import type { ReactNode } from "react";
import { Drawer } from "antd";
import styles from "./SceneSettingsDrawer.module.css";

/**
 * 场景设置抽屉（2026-11-23）。
 *
 * <h2>为什么要有这个</h2>
 *
 * <p>客户要求顶栏只保留 11 个入口。而原来顶栏挤了 **18 个**按钮
 * （撤销、重做、查找对象、应用对接结果、核对绑定、模板配置、数据源、
 * 告警、在线编程、选择模板、主题、导入模型、导入示例…）——
 * 1920 屏上根本排不下，窄屏直接换行成两三层。
 *
 * <p>**功能一个都没删**，只是把「配置类」的收进这里。判断标准：
 * <ul>
 *   <li>顶栏留下的是**频繁操作**（保存、运行、发布、导出）；</li>
 *   <li>收进来的是**低频配置**（绑定、模板、数据源、告警、编程）。</li>
 * </ul>
 *
 * <h2>为什么用分组而不是一长列</h2>
 *
 * <p>13 个按钮平铺和原来顶栏一样难找。按「改什么」分组后，
 * 用户先想「我要改绑定」再找位置，比逐个扫按钮快。
 */
export function SceneSettingsDrawer({
  open,
  onClose,
  history,
  object,
  wiring,
  panels,
  templates,
  appearance,
  assets,
}: {
  open: boolean;
  onClose: () => void;
  /** 撤销 / 重做 */
  history?: ReactNode;
  /** 查找画面对象 */
  object?: ReactNode;
  /** 应用对接结果 */
  wiring?: ReactNode;
  /** 核对绑定 / 模板配置 / 数据源 / 告警 / 在线编程 */
  panels?: ReactNode;
  /** 选择画面模板 */
  templates?: ReactNode;
  /** 主题切换 */
  appearance?: ReactNode;
  /** 导入模型 / 导入示例 */
  assets?: ReactNode;
}) {
  const groups: Array<{ key: string; title: string; hint: string; body?: ReactNode }> = [
    { key: "history", title: "编辑历史", hint: "撤销 / 重做最近的操作", body: history },
    { key: "object", title: "画面对象", hint: "按名称查找并定位到某个对象", body: object },
    { key: "wiring", title: "对接结果", hint: "把画面接线文件应用到当前场景", body: wiring },
    {
      key: "panels",
      title: "配置面板",
      hint: "绑定核对、模板配置、数据源、告警、在线编程",
      body: panels,
    },
    { key: "templates", title: "画面模板", hint: "为这个场景选用预置大屏模板", body: templates },
    { key: "appearance", title: "外观", hint: "编辑器主题", body: appearance },
    { key: "assets", title: "模型与示例", hint: "导入自己的 GLB，或加载演示模型", body: assets },
  ];

  return (
    <Drawer
      title="场景设置"
      open={open}
      onClose={onClose}
      placement="right"
      width={420}
      data-testid="scene-settings-drawer"
      /*
       * 不挂 mask：设置面板常常要「一边看画布一边改」，
       * 遮罩会让画布变灰、也挡住点击。
       */
      mask={false}
      rootClassName={styles.root}
    >
      {groups.map((group) =>
        group.body ? (
          <section key={group.key} className={styles.group} data-testid={`settings-group-${group.key}`}>
            <header className={styles.head}>
              <span className={styles.title}>{group.title}</span>
              <span className={styles.hint}>{group.hint}</span>
            </header>
            <div className={styles.body}>{group.body}</div>
          </section>
        ) : null,
      )}
    </Drawer>
  );
}
