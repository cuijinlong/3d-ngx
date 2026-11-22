#!/bin/bash
# mesh-network 一键巡检（Mac / Linux 通用）
# 检查三段：① 公网直连（默认通道）② WG 内网（兜底/反向）③ 中转策略
set -u

DIRECT="124.220.77.179:124国泰 49.234.181.201:49金诺 150.158.41.155:150中转"
WGPEERS="10.88.0.1:150总机 10.88.0.2:49金诺 10.88.0.4:124国泰 10.88.0.5:Mac 10.88.0.6:Windows"

PINGTO=2
if ping -c1 -W$PINGTO 127.0.0.1 >/dev/null 2>&1; then PINGOPT="-W$PINGTO"; else PINGOPT="-t$PINGTO"; fi

echo "===== mesh-network 巡检 $(date '+%F %T') ====="
echo "本机: $(hostname)"

echo
echo "--- ① 公网直连（Mac 执行服务器任务的默认通道，无中转）---"
for item in $DIRECT; do
  ip=${item%%:*}; name=${item##*:}
  printf "  %-18s %-8s " "$ip" "$name"
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new root@$ip hostname 2>/dev/null | tail -1)
  if [ -n "$out" ]; then echo "OK  ($out)"; else echo "FAILED（可试 <主机>-via150）"; fi
done

echo
echo "--- ② WG 内网（反向访问/Windows/兜底；peer 间流量经 150 转发）---"
if command -v wg >/dev/null 2>&1; then wg show 2>/dev/null | head -6
elif [ -x /usr/local/bin/wg ]; then sudo -n /usr/local/bin/wg show 2>/dev/null | head -6
else echo "  (无 wg 命令，跳过接口信息)"; fi

for item in $WGPEERS; do
  ip=${item%%:*}; name=${item##*:}
  printf "  %-10s %-8s " "$ip" "$name"
  if ping -c2 $PINGOPT "$ip" >/dev/null 2>&1; then echo "OK"; else echo "FAILED"; fi
done

echo
echo "--- ③ 中转策略（只允许 150 转发；124/49 必须 0）---"
for ip in 10.88.0.1 10.88.0.2 10.88.0.4; do
  printf "  %-10s ip_forward=" "$ip"
  v=$(ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new root@$ip \
        'cat /proc/sys/net/ipv4/ip_forward' 2>/dev/null)
  echo "${v:-n/a}"
done
echo "  期望: .1=1（唯一中转）, .2=0, .4=0"

echo
echo "--- ④ 环境检查（VPN 冲突 / 默认路由）---"
DEF=$(netstat -rn -f inet 2>/dev/null | awk '$1=="default"{print $NF; exit}')
echo "  默认路由接口: ${DEF:-未知}（应为 en0/en1 物理网卡）"
if [ -n "${DEF:-}" ] && [ "$DEF" != "en0" ] && [ "$DEF" != "en1" ]; then
  echo "  ⚠️ 默认路由不在物理网卡：疑似 VPN/隧道接管，会把源地址选成隧道地址导致全断"
fi
if command -v scutil >/dev/null 2>&1; then
  for svc in "速博士" "SubOS"; do
    s=$(scutil --nc status "$svc" 2>/dev/null | head -1)
    if [ -n "$s" ]; then
      echo "  VPN[$svc]: $s"
      [ "$s" = "Connected" ] && echo "  ❌ 速博士已连接：会同时切断组网与服务器直连 → 先执行 scripts/vpn-off.sh"
    fi
  done
fi

echo
echo "===== 完成 ====="
