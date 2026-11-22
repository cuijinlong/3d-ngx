# 排障手册

## 0. 先分清是哪条通道，再看对应小节

```bash
bash scripts/verify-network.sh
```

输出会分三段：直连（通道 A）、WG（通道 B）、中转策略。先看哪段红。

## 1. 直连不通（通道 A）

```bash
ping -c2 124.220.77.179     # 网络层
nc -zv 124.220.77.179 22    # 端口层
ssh -v gt124                # 认证层
```

| 卡在哪 | 处理 |
|---|---|
| ping 不通 | 本机网络/运营商问题，或服务器云安全组封了来源 IP；换 `ssh gt124-via150` 应急 |
| ping 通、22 不通 | 服务器 sshd 挂了或安全组规则变了：经 `-via150` 进去 `systemctl status sshd` |
| 22 通、认证失败 | 公钥没授权：确认目标机 `~/.ssh/authorized_keys` 有 `macmini` 那把 |
| 偶发超时 | 走 `-via150` 兜底，别反复重试直连 |

## 2. WG 不通（通道 B）

```bash
sudo wg show          # Mac 需 sudo
```

| 现象 | 处理 |
|---|---|
| 无 `latest handshake` | 到 150 的 udp/51820 不通：`nc -uzv 150.158.41.155 51820`；150 上查 `ufw status` 是否放行 |
| 有握手但 ping 不对端 | 150 上 `cat /proc/sys/net/ipv4/ip_forward` 必须=1；`ufw route` 是否放行 wg0→wg0 |
| 只有本机能通 | 分机 `AllowedIPs` 是否 `10.88.0.0/24`；总机侧是否精确 `/32` |
| 重启后失联 | Linux `systemctl status wg-quick@wg0`；Mac `launchctl print system/com.fengguoqiang.device-mesh` |

## 3. Mac 特有坑（已经踩过）

1. **`wg-quick` 不可用**：要求 bash 4+，macOS 自带 3.2 → 不要试图装 bash5（Homebrew bash 依赖 readline/ncurses/gettext 三套库，成本高）
2. **`wireguard-go` 必须加 `-f`**：默认会自行 daemonize 到后台，父进程退出 → launchd 判定任务结束 → KeepAlive 反复重启 → 接口互踩挂掉。日志特征：`/var/log/wg-mesh.log` 里反复出现 `wg mesh up`
3. **`wg setconf` 不认 `Address`/`MTU`**：配置必须拆成两个文件——`wg0.iface.conf`（纯 Interface+Peer，给 setconf 用）和人类可读的 `wg0.conf`
4. **接口名是动态的**（`utunN`）：脚本靠 `/var/run/wireguard/*.sock` 反查，不要写死 utun4
5. **二进制是 ad-hoc 签名**：作为 LaunchDaemon 运行时系统日志会出现 `AMFI: no CMS blob`，但实测可正常运行，忽略即可

## 4. 服务器反向连 Mac 失败

```bash
# 服务器上
ping -c2 10.88.0.5
ssh -o BatchMode=yes fengguoqiang@10.88.0.5 hostname
```

- Mac 守护是否在：`sudo launchctl print system/com.fengguoqiang.device-mesh | grep state`
- Mac 远程登录是否开：`sudo systemsetup -getremotelogin`
- Mac sshd 是否监听：`sudo lsof -nP -iTCP:22 -sTCP:LISTEN`
- 公钥是否在：`cat ~/.ssh/authorized_keys | awk '{print $NF}'`

## 5. 改对端不要断线

```bash
wg syncconf wg0 <(wg-quick strip wg0)   # Linux
```

`restart` 会重建接口，正在跑的 SSH 全断，150 上尤其致命（所有分机的枢纽）。

## 6. 禁止事项

- ❌ 用 124 当跳板 / ProxyJump / 路由中转（`ip_forward=0`，且策略不允许）
- ❌ 把 `mesh-124`（10.88.0.4）当成"直连"用 —— 它经 150 转发，会绕远
- ❌ 在 150 上删错 peer（等于某台分机掉线）
- ❌ 把私钥写进任何文档/仓库
