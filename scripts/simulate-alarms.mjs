#!/usr/bin/env node
/**
 * 在平台上模拟几条活跃告警（2026-11-23 客户要求）。
 *
 * <p>客户原话：「我需要在3D周围加一个告警列表跑马灯效果」+
 * 「把之前说的设备手册的原型写在告警中」+
 * 「告警右上角有个等级筛选，把最严重的常驻，然后其他的跑马灯」。
 *
 * <p>平台当前告警都属于**资产**（`originator_type = 5`），
 * 而大屏看的是 9 台**设备**（`originator_type = 6`）。没有设备级告警时，
 * 跑马灯只会显示「当前无活跃告警」—— 功能正确但看不到效果。
 *
 * <h2>为什么直接写库，而不是走 REST</h2>
 *
 * <p>ThingsBoard **没有**公开的「创建告警」REST 接口 ——
 * 告警由规则引擎产生。要在没有真实规则链的情况下造告警，
 * 只剩两条路：改规则链（污染平台配置）或直接插表。
 * 选后者，并且**只动自己插的行**（按 originator + 时间窗识别）。
 *
 * <h2>type 字段就是告警文本</h2>
 *
 * <p>`guard-provider.getAlarms()` 把 `type` 当 `message`，
 * 前端再从这段文本里抽故障码（`extractFaultCodes`）。
 * 所以 `type` 里必须带**真实手册里的码**（`TH702` / `CM071`），
 * 否则字典查不到，告警条目就只剩一句裸代码。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/simulate-alarms.mjs --dry-run
 * node scripts/simulate-alarms.mjs            # 写入
 * node scripts/simulate-alarms.mjs --purge    # 清掉本脚本写的告警
 * ```
 */

import { execFileSync } from "node:child_process";

const DB_CONTAINER = process.env.TB_DB_CONTAINER || "energy-postgres";
const DB_NAME = process.env.TB_DB_NAME || "thingsboard";

const DRY = process.argv.includes("--dry-run");
const PURGE = process.argv.includes("--purge");

/**
 * 要造的告警。
 *
 * <p>等级映射来自 `guard-provider.getAlarms()`：
 * `CRITICAL` / `MAJOR` → 前端 `level = "alarm"`；
 * 其余（`MINOR` / `WARNING` …）→ `level = "warning"`。
 * 这样界面上才有「告警」与「预警」两组可筛。
 *
 * <p>三条的**时间戳故意错开**：最新的不一定是 severest ——
 * 这正好能验证「最严重的常驻，而不是最新的常驻」这条逻辑。
 */
const ALARMS = [
  {
    deviceName: "天骄-模块机-2#·生产园区",
    /** 与它 `sys_run_state = 8`（故障）对应，不是凭空造的告警 */
    type: "出水温度传感器失效 TH702",
    severity: "CRITICAL",
    /** 分钟前。数字越大越早。 */
    minutesAgo: 55,
  },
  {
    deviceName: "天骄-模块机-3#·生产园区",
    type: "主机与1#变频水泵通讯故障 CM071",
    severity: "MAJOR",
    minutesAgo: 25,
  },
  {
    deviceName: "天骄-模块机-5#·生产园区",
    /*
     * 预警级：设备从没上报过，通讯超时是**合理**的推断。
     * 这条最新的，但严重度低于 TH702 —— 正好用来验证常驻判定。
     */
    type: "设备遥测上报中断（超过 24 小时未收到数据）",
    severity: "MINOR",
    minutesAgo: 5,
  },
];

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

/**
 * `originator_type` 的正确值。
 *
 * <h2>★ 这是 0 起索引，不是 1 起（2026-11-23 实测两个错值后确认）</h2>
 *
 * <p>TB 的 `EntityType` 枚举以 `ordinal()` 存库：
 * <pre>
 * 0 TENANT 1 CUSTOMER 2 USER 3 DASHBOARD 4 ASSET 5 DEVICE 6 ALARM 7 ENTITY_GROUP
 * </pre>
 *
 * <p>踩过的两个错值：
 * <ul>
 *   <li>`6` —— 按「1 起索引」算出来的，实际是 **ALARM**；</li>
 *   <li>`7` —— 下一个，实际是 **ENTITY_GROUP**。</li>
 * </ul>
 *
 * <p>两者都不报错：告警插进去了，API 也返回了，只是 `originatorName`
 * 显示成 `Deleted` —— 因为拿设备 id 去 entity_group 表里找，当然找不到。
 * 而前端跑马灯拿 `deviceName` 作标题，于是每条告警的标题都是「Deleted」。
 *
 * <p>**判据**：`GET /api/alarms` 返回的 `originator.entityType` 必须是 `DEVICE`。
 */
const ORIGINATOR_DEVICE = 5;

/**
 * 识别「本脚本写的告警」。
 *
 * <p>不能只按 `type` 匹配：现场可能真有一条同名的。
 * 判据用 **`additional_info` 里的标记** —— 那是 TB 留给业务附加信息的字段，
 * 我们写进去一个固定 tag，清理时只删带 tag 的行。
 */
const DEMO_TAG = "ngx-demo-alarm";

function buildInsert(alarm, now) {
  const startTs = now - alarm.minutesAgo * 60 * 1000;
  return `
INSERT INTO alarm (
  id, created_time, start_ts, originator_id, originator_type,
  severity, type, tenant_id, customer_id,
  acknowledged, cleared, propagate, propagate_to_owner, propagate_to_tenant,
  propagate_to_owner_hierarchy, assign_ts, additional_info
)
SELECT
  gen_random_uuid(), ${startTs}, ${startTs}, d.id, ${ORIGINATOR_DEVICE},
  '${alarm.severity}', '${alarm.type.replace(/'/g, "''")}', d.tenant_id, d.customer_id,
  false, false, false, false, false,
  /*
   * ★ propagate_to_owner_hierarchy 不能漏。
   *
   * 它是 Boolean（非原始类型），漏了就是 NULL，TB 反序列化时
   * this.propagateToOwnerHierarchy.booleanValue() 直接 NPE，
   * 整个 GET /api/alarms 返回 500。
   *
   * 实测：插完三条告警后告警面板整个打不开（而不是少几条）。
   * 一个字段没写就让整个接口不可用，是本项目里成本最高的一类坑。
   *
   * 注意：这段注释在**模板字符串内部**，所以不能写反引号 ——
   * 反引号会把模板字符串提前终止，报 "Unexpected identifier"。
   */
  false, 0, '{"demoTag":"${DEMO_TAG}"}'
FROM device d
WHERE d.name = '${alarm.deviceName.replace(/'/g, "''")}';`;
}

function purgeSql() {
  return `DELETE FROM alarm WHERE additional_info LIKE '%"${DEMO_TAG}"%' OR additional_info LIKE '%${DEMO_TAG}%';`;
}

function main() {
  const now = Date.now();

  if (PURGE) {
    if (DRY) {
      console.log("预演：将删除所有带 demoTag 的告警");
      return;
    }
    const before = psql(`SELECT count(*) FROM alarm WHERE additional_info LIKE '%${DEMO_TAG}%';`);
    psql(purgeSql());
    console.log(`✓ 已删除 ${before} 条模拟告警`);
    return;
  }

  console.log(DRY ? "模式：预演（不写库）" : "模式：写入");
  console.log("");

  /*
   * 幂等：先清掉本脚本上一轮写的，再重新插。
   *
   * <p>不先清就会重复 —— 连跑两次变成 6 条相同告警。
   * 而跑马灯里两条一模一样的告警看起来像渲染 bug，很难往「脚本重复执行」想。
   */
  if (!DRY) {
    psql(purgeSql());
  }

  for (const alarm of ALARMS) {
    const exists = psql(
      `SELECT count(*) FROM device WHERE name = '${alarm.deviceName.replace(/'/g, "''")}';`,
    );
    if (exists === "0") {
      console.log(`✗ 找不到设备：${alarm.deviceName}`);
      process.exitCode = 1;
      continue;
    }
    const level = alarm.severity === "CRITICAL" || alarm.severity === "MAJOR" ? "告警" : "预警";
    console.log(`${alarm.deviceName}`);
    console.log(`  ${alarm.severity}（${level}）· ${alarm.minutesAgo} 分钟前`);
    console.log(`  文本：${alarm.type}`);
    if (!DRY) {
      psql(buildInsert(alarm, now));
      console.log("  已写入");
    }
    console.log("");
  }

  if (!DRY) {
    const total = psql(`SELECT count(*) FROM alarm WHERE additional_info LIKE '%${DEMO_TAG}%';`);
    console.log(`✓ 完成，本脚本共有 ${total} 条模拟告警`);
    console.log("");
    console.log("注意：这些是**演示告警**，不是规则引擎产生的。");
    console.log("撤销：node scripts/simulate-alarms.mjs --purge");
  }
}

main();
