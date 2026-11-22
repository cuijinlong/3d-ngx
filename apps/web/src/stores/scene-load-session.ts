/** 打开场景的请求世代：超时、离开页面或开了一次新的 load 之后，过期结果不得写回 store。 */
export interface LoadTicket {
  readonly id: number;
  isCurrent(): boolean;
  /** 仅当这张票还是当前世代时作废，避免误伤已开始的下一次 load。 */
  expire(): void;
}

export function createLoadSession() {
  let generation = 0;
  return {
    begin(): LoadTicket {
      const id = ++generation;
      return {
        id,
        isCurrent: () => id === generation,
        expire: () => {
          if (id === generation) generation += 1;
        },
      };
    },
    invalidate() {
      generation += 1;
    },
  };
}
