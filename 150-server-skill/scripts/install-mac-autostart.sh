#!/bin/bash
# 在 macOS 上安装 device-mesh 的开机自启守护（wireguard-go 方案）
# 前提：/usr/local/bin/{wireguard-go,wg} 已存在，/usr/local/etc/wireguard/wg0.iface.conf 已就位
# 用法: sudo bash install-mac-autostart.sh
set -eu
[ "$(id -u)" = "0" ] || { echo "需要 root"; exit 1; }

MESH_IP="${MESH_IP:-10.88.0.5}"
CONF=/usr/local/etc/wireguard/wg0.iface.conf
[ -f "$CONF" ] || { echo "缺少 $CONF"; exit 1; }

mkdir -p /usr/local/libexec

cat > /usr/local/libexec/wg-mesh.sh <<'EOS'
#!/bin/bash
# device-mesh: Mac 侧 WireGuard 自动接入（bash3 兼容）
set -u
CONF=/usr/local/etc/wireguard/wg0.iface.conf
WG=/usr/local/bin/wg
WGGO=/usr/local/bin/wireguard-go
ADDR=${MESH_IP:-10.88.0.5}
MTU=1420

[ -f "$CONF" ] || { echo "missing $CONF"; exit 1; }
rm -f /var/run/wireguard/utun*.sock 2>/dev/null || true

# 关键：-f 前台运行，交给 launchd 托管（否则其自行 daemonize 会导致重启风暴）
"$WGGO" -f utun &
WGPID=$!
trap 'kill $WGPID 2>/dev/null' EXIT INT TERM

SOCK=""
for i in $(seq 1 50); do
  sleep 0.2
  SOCK=$(ls -t /var/run/wireguard/*.sock 2>/dev/null | head -1)
  [ -n "$SOCK" ] && break
done
[ -n "$SOCK" ] || { echo "wireguard-go 未创建 socket"; exit 1; }
IF=$(basename "$SOCK" .sock)

"$WG" setconf "$IF" "$CONF" || exit 1
/sbin/ifconfig "$IF" inet $ADDR $ADDR netmask 255.255.255.0 mtu $MTU up || exit 1
/sbin/route add -net 10.88.0.0 -netmask 255.255.255.0 -interface "$IF" 2>/dev/null || true
echo "wg mesh up: $IF $ADDR"
wait $WGPID
EOS
sed -i '' "s/ADDR=\${MESH_IP:-10.88.0.5}/ADDR=${MESH_IP}/" /usr/local/libexec/wg-mesh.sh
chmod 755 /usr/local/libexec/wg-mesh.sh

cat > /Library/LaunchDaemons/com.fengguoqiang.device-mesh.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fengguoqiang.device-mesh</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>/usr/local/libexec/wg-mesh.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/var/log/wg-mesh.log</string>
  <key>StandardErrorPath</key><string>/var/log/wg-mesh.log</string>
</dict>
</plist>
PLIST
chmod 644 /Library/LaunchDaemons/com.fengguoqiang.device-mesh.plist

launchctl bootout system/com.fengguoqiang.device-mesh 2>/dev/null || true
launchctl bootstrap system /Library/LaunchDaemons/com.fengguoqiang.device-mesh.plist
echo "==> 已安装。查看: launchctl print system/com.fengguoqiang.device-mesh"
