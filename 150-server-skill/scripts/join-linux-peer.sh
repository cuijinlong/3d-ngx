#!/bin/bash
# 把一台 Linux 机器接入 device-mesh（以 150 为唯一总机）
# 用法: bash join-linux-peer.sh <本机WG_IP> <总机公钥> [总机Endpoint]
# 例:   bash join-linux-peer.sh 10.88.0.7 "HiQU2X1L2xA6bxJ9Jy7S3CoZUS5ozONqzJo4EyFNkng=" 150.158.41.155:51820
set -eu

WG_IP="${1:-}"
HUB_PUB="${2:-}"
ENDPOINT="${3:-150.158.41.155:51820}"

if [ -z "$WG_IP" ] || [ -z "$HUB_PUB" ]; then
  echo "用法: $0 <本机WG_IP> <总机公钥> [总机Endpoint]"; exit 1
fi
[ "$(id -u)" = "0" ] || { echo "需要 root"; exit 1; }

echo "==> 安装 wireguard-tools"
if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y -qq wireguard-tools
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y wireguard-tools
elif command -v yum >/dev/null 2>&1; then
  yum install -y wireguard-tools
fi

mkdir -p /etc/wireguard && chmod 700 /etc/wireguard
[ -f /etc/wireguard/wg0.key ] || { umask 077; wg genkey > /etc/wireguard/wg0.key; }
chmod 600 /etc/wireguard/wg0.key
wg pubkey < /etc/wireguard/wg0.key > /etc/wireguard/wg0.pub

if [ -f /etc/wireguard/wg0.conf ]; then
  cp /etc/wireguard/wg0.conf "/etc/wireguard/wg0.conf.bak-$(date +%Y%m%d%H%M)"
  echo "==> 已备份原 wg0.conf"
fi

cat > /etc/wireguard/wg0.conf <<CFG
# device-mesh 分机  建立：$(date +%F)
# 注意：中转只走总机，本机不做转发
[Interface]
Address    = ${WG_IP}/24
PrivateKey = $(cat /etc/wireguard/wg0.key)

[Peer]
# 总机（唯一中转节点）
PublicKey    = ${HUB_PUB}
Endpoint     = ${ENDPOINT}
AllowedIPs   = 10.88.0.0/24
PersistentKeepalive = 25
CFG
chmod 600 /etc/wireguard/wg0.conf

echo "==> 启动并设为开机自启"
systemctl enable --now wg-quick@wg0
sleep 2

echo "==> 本机公钥（拿到总机上登记）:"
cat /etc/wireguard/wg0.pub
echo
echo "==> 在总机 150 上执行:"
echo "    wg set wg0 peer \$(cat /etc/wireguard/wg0.pub) allowed-ips ${WG_IP}/32"
echo "    # 并追加到 /etc/wireguard/wg0.conf 持久化"
echo
wg show wg0 | head -12
