---
name: mesh-network
description: 五机互访网络（124 国泰 / 150 中转 / 49 金诺 / Mac / Windows）。Mac 执行服务器任务时直连优先、不经中转；150 仅在特殊情况兜底；124/49 永不做中转。跨机 SSH、反向访问、新机入网、排障时使用。
---

# mesh-network · 五机互访网络

## 0. 结论先行（每次动手前先看这 30 秒）

| 场景 | 走法 |
|---|---|
| **Mac 执行 124 / 49 / 150 的任务** | ✅ **直连公网 IP，不经任何中转** |
| 直连超时 / 被阻断 | 兜底：`ssh <主机>-via150`（经 150 中转一次） |
| **服务器反向访问 Mac**（Mac 在 NAT 后） | 必须走 WireGuard 内网 `10.88.0.5` |
| Windows ↔ 其他机器 | 走 WireGuard 内网 `10.88.0.6` |
| 124 / 49 之间互访 | 走 WG（实质经 150 转发） |
| **拿 124 当跳板/中转** | ❌ 永远不允许（`ip_forward=0`，物理上也不通） |

> ⚠️ 关键认知：WG 是**星型**拓扑，peer 之间的流量**必然经过 150 转发**。
> 所以"Mac 直连 124/49 不走中转"= 必须走**公网 SSH**，而不是走 10.88.x。这两条通道别混用。

## 0.1 ⚠️ 头号杀手：速博士（SubOS）VPN

**症状**：某天突然三台服务器全连不上（`No route to host` / `Connection closed` / `Network is unreachable`），WireGuard 停止握手，服务器反连 Mac 失败，Windows 也连不到 Mac。

**根因**：速博士连接后会接管默认路由（`utun5`，地址 `240.0.0.1`），并给三台服务器下发走隧道的路由。此时：
- 即使手动把路由改回 en1，**内核选源地址仍会挑 VPN 的 240.0.0.1** → 上游直接丢弃（证据：`ping -S 192.168.31.156 150.158.41.155` 通，不带 `-S` 不通）
- 组网与服务器直连**同时报废**

**处理**：
```bash
bash scripts/vpn-off.sh          # 断开 VPN + 等组网恢复
scutil --nc status "速博士"       # 确认已断开
```
**注意**：速博士设置了 `OnDemandEnabled: TRUE`，会按需自动重连 —— 跑服务器任务前先确认它是 `Disconnected`。
`verify-network.sh` 的「④ 环境检查」会自动检测这个冲突。


## 1. 两条通道

```
通道 A（默认·直连，无中转）
  Mac ──SSH/公网──▶ 124.220.77.179
  Mac ──SSH/公网──▶ 49.234.181.201
  Mac ──SSH/公网──▶ 150.158.41.155

通道 B（特殊/反向·经 150 星型转发）
  Mac 10.88.0.5 ──▶ 150 10.88.0.1 ──▶ 124 10.88.0.4 / 49 10.88.0.2
  124/49/150 ──▶ 10.88.0.5（反向访问 Mac，NAT 穿不透，只能靠隧道）
```

## 2. 地址表

| 角色 | 主机名 | 公网 IP（直连用） | WG 内网 | 转发 |
|---|---|---|---|---|
| 总机·中转 | VM-0-16-ubuntu | 150.158.41.155 | 10.88.0.1 | ✅ 唯一 |
| 业务机·国泰 | VM-0-10-opencloudos | 124.220.77.179 | 10.88.0.4 | ❌ |
| 业务机·金诺 | VM-0-15-ubuntu | 49.234.181.201 | 10.88.0.2 | ❌ |
| Mac Mini | fengguongdeMini | 无（NAT） | 10.88.0.5 | ❌ |
| Windows | 待补 | 无（NAT） | 10.88.0.6 | ❌ |

## 3. 命令速查

```bash
# ---- 默认：直连（Mac 上执行服务器任务就用这个）----
ssh gt124          # → 124.220.77.179 国泰
ssh jinnuo49       # → 49.234.181.201 金诺
ssh relay150       # → 150.158.41.155 中转

# ---- 兜底：直连不通时经 150 中转 ----
ssh gt124-via150
ssh jinnuo49-via150

# ---- WireGuard 内网（反向访问/Windows/特殊场景）----
ssh mesh-150       # 10.88.0.1
ssh mesh-124       # 10.88.0.4
ssh mesh-49        # 10.88.0.2
ssh mesh-win       # 10.88.0.6（Windows 入网后）

# ---- 从服务器/Windows 反向连 Mac（Mac 在 NAT 后，只能走 WG）----
ssh fengguoqiang@10.88.0.5   # 普通用户（sudo 免密）
ssh root@10.88.0.5           # root 仅密钥登录（已授权各机公钥）
```

**Mac 已授权的客户端钥匙（`~/.ssh/authorized_keys` 与 `/var/root/.ssh/authorized_keys` 同步）**：
`macmini`（本机）、`dsh-newbox`（150）、`jinnuo49`（49）、124 的无注释钥匙、`local-admin-fengdesktop-20260911`（**Windows 桌面**）。

**Windows 已入网**：`10.88.0.6`，其 SSH 钥匙为 `local-admin-fengdesktop-20260911`，可直接
`ssh root@10.88.0.5` 或 `ssh fengguoqiang@10.88.0.5`。

Mac 上的 `~/.ssh/config` 已按此规则配好（别名固定，勿随意改动指向）。

## 4. 决策树

```
要连 124 / 49 / 150？
├─ 发起方是 Mac？ ──是──▶ 公网直连（ssh gt124 / jinnuo49 / relay150）
│                        └─ 超时/拒绝 ──▶ ssh <主机>-via150
└─ 发起方是服务器？ ──▶ 目标在 NAT 后（Mac/Windows）？ ──是──▶ 走 WG 10.88.0.x
                                                        └─ 否 ──▶ 公网直连或 WG 均可
需要跳板？ ──▶ 只能用 150（124/49 禁止）
```

## 5. 各系统接入

### A. macOS（本机，已落地并开机自启）

macOS 无 bash4，`wg-quick` 跑不了；`wireguard-go` 会自行 daemonize 导致 launchd 反复重启。本机方案：

- 二进制：`/usr/local/bin/{wireguard-go,wg}`（Homebrew 官方 bottle 手动落盘）
- 配置：`/usr/local/etc/wireguard/wg0.iface.conf`（**纯 Interface+Peer**，不含 Address —— `wg setconf` 不认）
- 守护脚本：`/usr/local/libexec/wg-mesh.sh`（必须 `wireguard-go -f utun` 前台运行）
- 自启：`/Library/LaunchDaemons/com.fengguoqiang.device-mesh.plist`（`KeepAlive=true`，实测强杀 3 秒自愈）
- 重装：`sudo bash scripts/install-mac-autostart.sh`

### B. Linux 分机（参考 49）

```bash
bash scripts/join-linux-peer.sh <本机WG_IP> <150公钥> 150.158.41.155:51820
# 回 150 登记：wg set wg0 peer <新机公钥> allowed-ips 10.88.0.x/32
```

### C. Windows（待入网）

配置已生成在 Mac 工作区 `windows-wg-10.88.0.6.conf`（含私钥，勿外传）：

1. `winget install WireGuard.WireGuard`
2. 导入 `.conf` → 激活 → 勾选开机启动
3. 验证：`ping 10.88.0.1`、`Test-NetConnection 10.88.0.1 -Port 22`

## 6. 巡检

```bash
bash scripts/verify-network.sh     # 直连 3 台 + WG 5 节点 + 中转策略
```

## 7. 排障要点

| 现象 | 先分清是哪条通道 | 处理 |
|---|---|---|
| `ssh gt124` 超时 | 通道 A | 先 `ping 124.220.77.179`；通就查 sshd；不通换 `-via150` |
| `ssh mesh-124` 不通 | 通道 B | `wg show` 有无握手；150 的 `ip_forward` 是否=1 |
| 服务器连不到 Mac | 通道 B | Mac 守护是否在跑：`launchctl print system/com.fengguoqiang.device-mesh` |
| 重启后全断 | 通道 B | Linux: `systemctl status wg-quick@wg0`；Mac: `tail /var/log/wg-mesh.log` |
| 想"不经中转"连 124 | — | 用公网直连别名，**不要**用 `mesh-124`（那走 150） |
| **三台服务器同时全断** | 先查环境 | **多半是速博士 VPN 连上了**（抢默认路由 + 源地址错）→ `bash scripts/vpn-off.sh` |
| 服务器连不到 Mac，但 Mac 能连服务器 | 通道 B | 先确认 VPN 已断开；再查 Mac 守护与 sshd（见 troubleshooting） |

详细：[references/troubleshooting.md](references/troubleshooting.md)

## 8. 回滚

```bash
# Mac
sudo launchctl bootout system/com.fengguoqiang.device-mesh
# Linux 分机
systemctl disable --now wg-quick@wg0
# 150 移除 peer
wg set wg0 peer <公钥> remove
```

## 9. 相关文件

- 各机根目录：`/MESH-NETWORK.md`；服务器登录横幅 `/etc/profile.d/00-device-mesh.sh`
- 服务器 skill 副本：`/opt/device-mesh/`（历史路径，内容以本 skill 为准）
- 拓扑细节：[references/topology.md](references/topology.md)
