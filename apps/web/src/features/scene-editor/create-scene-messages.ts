/** 新建场景向导的提示文案。存储失败要让人看出「没入库」，不要再说现网尚未上线。 */

export const WIZARD_COPY = {
  namePlaceholder: "给这个场景起个名字",
  /*
   * `createTopology` / `createTopologyHint` 已移除（2026-11-24）：
   * 「设备拓扑」选择项删掉后没有引用点。留着会让人以为向导还有这个分支。
   */
  packsFallback:
    "风格套装字典暂时无法读取，已用已登记套装兜底。已连接时仍会尝试上传到平台存储。",
  packsSelectFallback: "风格套装字典暂时无法读取，已用已登记套装兜底",
  scopeMissing: "范围选项这次没能从平台读到，已跳过，不阻断创建。不选即覆盖该视图全部。",
  scopeMissingPlaceholder: "暂时无法列出具体分项/分区/用能性质",
  uploadExtra:
    "仅接受 .glb，最大 48MB。已连接且存储可用时会上传到平台对象存储；若上传失败，模型只保存在本机 IndexedDB，并会明确提示未入库。",
  localStoreOnly:
    "模型未能写入平台对象存储，仅保存在本机 IndexedDB，平台侧尚未入库。本地场景仍可创建，但不要当成已经上传到平台。",
  /*
   * 403 单独一条（2026-11-24）。
   *
   * <p>上传端点只对租户开放，客户身份上传必然 403。原来这种情况
   * 也走「仅保存在本机」—— 用户会以为是网络问题、反复重试，
   * 而真相是「你的身份本来就不能上传，选模板模型就行」。
   */
  uploadForbidden:
    "当前身份不能上传模型（只有租户可以）。请改选平台模板 —— 模板里的模型会由服务端自动复制到新场景。",
  createdWithPlatform: "已创建场景并记下场站/拓扑引用",
  createdLocal: "已创建本地场景",
  createdDegraded: "已创建本地场景，但模型未能写入平台对象存储（尚未入库），仅保存在本机 IndexedDB。",
} as const;

const FORBIDDEN_LEGACY = [
  "尚未随现网 JAR 上线",
  "现网尚未上线",
  "现网未部署",
  "把 scope-options 当成了 topologyId",
  "现网暂不可用",
];

export function assertNoRootsInWizardCopy(text: string): void {
  if (/(^|[^a-zA-Z])roots([^a-zA-Z]|$)/.test(text) || text.includes("作为 roots")) {
    throw new Error("向导现场文案不应出现 roots");
  }
}

export function assertNoLegacyStoreCopy(text: string): void {
  for (const phrase of FORBIDDEN_LEGACY) {
    if (text.includes(phrase)) {
      throw new Error(`向导文案不应再使用「${phrase}」`);
    }
  }
}

export function stylePackLoadHint(usedFallback: boolean, _status?: number): string | undefined {
  if (!usedFallback) return undefined;
  return WIZARD_COPY.packsFallback;
}

export function stylePackSelectExtra(usedFallback: boolean): string | undefined {
  return usedFallback ? WIZARD_COPY.packsSelectFallback : undefined;
}

export function scopeOptionsExtra(scopeMissing: boolean, allLabel?: string): string | undefined {
  return scopeMissing ? WIZARD_COPY.scopeMissing : allLabel;
}

export function scopeOptionsPlaceholder(scopeMissing: boolean, allLabel?: string): string {
  return scopeMissing ? WIZARD_COPY.scopeMissingPlaceholder : allLabel || "不选表示全部";
}

/**
 * 上传失败时给用户看的话。
 *
 * <p>403 与「存储不可用 / 网络异常」是两回事，不能共用一句话：
 * 前者是**身份限制**（换个人或改用模板就能解决），后者是环境问题。
 * 混在一起说，用户只会反复重试同一件注定失败的事。
 */
export function describeUploadFallback(error?: { status?: number; message?: string }): string {
  if (error?.status === 403) return WIZARD_COPY.uploadForbidden;
  return WIZARD_COPY.localStoreOnly;
}

export function createdSceneFeedback(input: {
  connected: boolean;
  siteId?: string;
  uploadDegraded: boolean;
}): { type: "success" | "warning"; text: string } {
  if (input.uploadDegraded) {
    return { type: "warning", text: WIZARD_COPY.createdDegraded };
  }
  if (input.connected && input.siteId) {
    return { type: "success", text: WIZARD_COPY.createdWithPlatform };
  }
  return { type: "success", text: WIZARD_COPY.createdLocal };
}

export function shouldDegradeUploadOnError(_error: { status?: number; message?: string }): boolean {
  // 已连接时上传失败一律明确降级到本机，不再把 404 / topologyId 400 解释成「现网未上线」。
  return true;
}


/** 保存结果的落点。取自 `scene.store` 的 `persistence`。 */
export interface SaveTarget {
  available: boolean;
  bindingsSource: "platform" | "local-draft";
  widgetsSource: "platform" | "local-draft" | "empty";
}

/**
 * 保存成功后该说「存到哪了」。
 *
 * <h3>为什么不能写死一句话（2026-11-24 修）</h3>
 *
 * <p>原来这里硬编码「已保存到本地」，而 `persist()` 在连上平台时
 * **真的会 PUT 到平台**（`saveSceneBindings` + `saveSceneWidgets`）。
 * 实测点了保存、提示「已保存到本地」，转头查接口发现数据已经写进去了 ——
 * 提示和事实相反。
 *
 * <p>后果不只是文案不雅：用户以为没入库，会反复点保存；
 * 或者反过来，换台机器发现改动还在（其实是有），从此不信保存按钮。
 *
 * <p>`available` 是「这次到底有没有落到平台」的权威判据 ——
 * 它由 `persist()` 按实际返回的 `source` 算出，不是猜的。
 */
export function describeSaveTarget(target: SaveTarget | undefined): string {
  return target?.available ? "已保存到平台" : "已保存到本机草稿";
}
