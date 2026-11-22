#!/bin/sh
# 检查本机到 150 中转机的连通性
# 用法：sh check-150.sh
IP=150.158.41.155

echo "① ping $IP ..."
ping -c 2 -W 2 "$IP" >/dev/null 2>&1 && echo "   ✅ 通" || echo "   ❌ 不通（先查本机网络，或本机 VPN 是否抢了路由）"

echo "② 端口 22 ..."
if command -v nc >/dev/null 2>&1; then
  nc -z -w 5 "$IP" 22 >/dev/null 2>&1 && echo "   ✅ 22 开放" || echo "   ❌ 22 连不上"
else
  echo "   (无 nc，跳过)"
fi

echo "③ SSH 免密登录 ..."
out=$(ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new root@"$IP" 'hostname; uptime -p' 2>&1)
case "$out" in
  *"Permission denied"*|*"publickey"*) echo "   ❌ 钥匙没登记：把本机 ~/.ssh/*.pub 追加到 150 的 /root/.ssh/authorized_keys" ;;
  *VM-0-16-ubuntu*)                   echo "   ✅ 已连通"; echo "$out" | sed 's/^/   /' ;;
  *)                                  echo "   ❌ 失败"; echo "$out" | sed 's/^/   /' ;;
esac
