import { getConnectedGuardClient, listPlatformCustomers } from "@idt/data-adapter";
import { useEffect, useState } from "react";
import { isUsableCustomerId } from "../../auth/customer-scope";

/** 用平台客户名单解析名字；对不上或无名时返回空，由面包屑改写为「选择客户」。 */
export function useCustomerName(customerId?: string | null): string {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!isUsableCustomerId(customerId)) {
      setName("");
      return;
    }

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    /*
     * client 未就绪时重试（2026-11-24 客户报障）。
     *
     * <h3>为什么必须重试</h3>
     *
     * <p>原实现只查一次：`getConnectedGuardClient()` 返回空就 `setName("")` 退出。
     * 而设计页刚打开时 guard 往往**还没连上** —— 这时 effect 已经跑完，
     * 依赖只有 `[customerId]`，client 后来连上了也不会重新解析。
     *
     * <p>后果就是客户看到的那一幕：顶栏面包屑第一级显示 `7ce48900…`。
     * **而且时好时坏** —— 能不能拿到名字取决于页面加载与连接的先后，
     * 比稳定地错还难查。
     *
     * <p>60 × 250ms = 15 秒：登录后连接一般 1~2 秒内就就绪，
     * 留 15 秒是给冷启动/慢网。真等不到就放弃（回退到短 id），
     * 不能无限重试。
     */
    const tryLoad = () => {
      if (cancelled) return;
      const client = getConnectedGuardClient();
      if (!client) {
        attempts += 1;
        if (attempts <= 60) timer = window.setTimeout(tryLoad, 250);
        return;
      }
      void listPlatformCustomers(client)
        .then((list) => {
          if (cancelled) return;
          setName(list.find((row) => row.id === customerId)?.name ?? "");
        })
        .catch(() => {
          if (!cancelled) setName("");
        });
    };

    tryLoad();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerId]);

  return name;
}
