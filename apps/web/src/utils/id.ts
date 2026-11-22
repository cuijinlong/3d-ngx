
export function createId(prefix: string): string {
  const rand = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `${prefix}_${rand}`;
}
