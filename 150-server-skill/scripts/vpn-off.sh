#!/bin/bash
# 断开速博士 VPN 并等待组网恢复（跑服务器任务前用）
# 速博士 OnDemand 会自动重连，连接期间会抢走默认路由并把源地址选成 240.0.0.1，
# 导致：SSH 直连三台服务器全断 + WireGuard 握手失效 + 服务器无法反连 Mac。
set -u

VPN_NAME="${VPN_NAME:-速博士}"
echo "==> 检查 $VPN_NAME 状态"
st=$(scutil --nc status "$VPN_NAME" 2>/dev/null | head -1)
echo "    当前: ${st:-未知（服务不存在？）}"

if [ "$st" = "Connected" ]; then
  echo "==> 断开 $VPN_NAME"
  scutil --nc stop "$VPN_NAME" 2>/dev/null
  for i in $(seq 1 15); do
    sleep 1
    s=$(scutil --nc status "$VPN_NAME" 2>/dev/null | head -1)
    [ "$s" = "Disconnected" ] && break
  done
  echo "    断开后: $(scutil --nc status "$VPN_NAME" 2>/dev/null | head -1)"
else
  echo "    未连接，无需操作"
fi

echo "==> 默认路由"
netstat -rn -f inet 2>/dev/null | awk '$1=="default"'

echo "==> 等待组网恢复（最多 40 秒）"
ok=0
for i in $(seq 1 20); do
  sleep 2
  if ping -c1 -t2 10.88.0.1 >/dev/null 2>&1 || ping -c1 -W2 10.88.0.1 >/dev/null 2>&1; then ok=1; break; fi
done

if [ "$ok" = "1" ]; then
  echo "==> 组网已恢复"
  echo "    150: $(ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new root@10.88.0.1 hostname 2>/dev/null | tail -1)"
else
  echo "!! 40 秒内未恢复，请检查: sudo wg show / launchctl print system/com.fengguoqiang.device-mesh"
fi
