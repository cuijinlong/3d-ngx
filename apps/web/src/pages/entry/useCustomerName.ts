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
    const client = getConnectedGuardClient();
    if (!client) {
      setName("");
      return;
    }
    let cancelled = false;
    void listPlatformCustomers(client)
      .then((list) => {
        if (cancelled) return;
        setName(list.find((row) => row.id === customerId)?.name ?? "");
      })
      .catch(() => {
        if (!cancelled) setName("");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return name;
}
