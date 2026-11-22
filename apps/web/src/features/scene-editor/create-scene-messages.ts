/** 新建场景向导的提示文案。存储失败要让人看出「没入库」，不要再说现网尚未上线。 */

export const WIZARD_COPY = {
  namePlaceholder: "给这个场景起个名字",
  createTopology: "创建新拓扑",
  createTopologyHint: "用上面选的场站和分组作为这个场景的范围。",
  packsFallback:
    "风格套装字典暂时无法读取，已用已登记套装兜底。已连接时仍会尝试上传到平台存储。",
  packsSelectFallback: "风格套装字典暂时无法读取，已用已登记套装兜底",
  scopeMissing: "范围选项这次没能从平台读到，已跳过，不阻断创建。不选即覆盖该视图全部。",
  scopeMissingPlaceholder: "暂时无法列出具体分项/分区/用能性质",
  uploadExtra:
    "仅接受 .glb，最大 48MB。已连接且存储可用时会上传到平台对象存储；若上传失败，模型只保存在本机 IndexedDB，并会明确提示未入库。",
  localStoreOnly:
    "模型未能写入平台对象存储，仅保存在本机 IndexedDB，平台侧尚未入库。本地场景仍可创建，但不要当成已经上传到平台。",
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

export function describeUploadFallback(_error?: { status?: number; message?: string }): string {
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

