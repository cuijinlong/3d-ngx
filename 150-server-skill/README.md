# 150 中转服务器 · 连接包

> 导出时间：2026-11-21 · 导出机器：Mac（fengguoqiang）
> 目标机：`VM-0-16-ubuntu` · 公网 `150.158.41.155` · Ubuntu 24.04 · root（**只认密钥，密码登录已关闭**）

这个文件夹给**另一台电脑**用：既能读「五机互访网络」skill，也能直接连上 150。

---

## 0. 30 秒认识 150

| 项 | 值 |
|---|---|
| 公网 IP | `150.158.41.155` |
| 用户 / 认证 | `root`，仅 SSH 密钥（`PasswordAuthentication no`） |
| 角色 | 五机 WireGuard 星型中枢（`10.88.0.1`，udp/51820）+ **唯一允许的中转跳板** |
| 上面在跑 | nginx(80/443 对公网)、MySQL(3306) / MQTT(1883)（只绑本机与 WG 内网）、若干 Java/Python 应用（127.0.0.1） |
| 别名 | `ssh relay150` 或 `ssh 150` |

124（国泰）和 49（金诺）**禁止**做中转；直连不通时统一经 150 转。

---

## 1. macOS / Linux：三步连上

```bash
# ① 放钥匙（权限必须 600）
mkdir -p ~/.ssh
cp keys/150-access ~/.ssh/150-access
chmod 600 ~/.ssh/150-access

# ② 写配置（追加到 ~/.ssh/config，已有内容别覆盖）
cat ssh/config.snippet >> ~/.ssh/config
chmod 600 ~/.ssh/config

# ③ 连
ssh -i ~/.ssh/150-access relay150
```

第一次连会问 host key。不想手动确认就把包里的指纹表并进去（可选）：

```bash
cat ssh/known_hosts-150 >> ~/.ssh/known_hosts
```

**自检**：`sh check-150.sh` —— 依次测 ping / 22 端口 / 免密登录，输出 ✅ 才算通。

> 想省掉每次 `-i`：把 `IdentityFile ~/.ssh/150-access` 写进 `relay150` 那段配置即可。

---

## 2. Windows（Win10/11 自带 OpenSSH）

PowerShell 里执行：

```powershell
# ① 放钥匙并收紧权限（Windows 权限不严 OpenSSH 会拒绝用这把钥匙）
$d = "$env:USERPROFILE\.ssh"; New-Item -ItemType Directory -Force -Path $d | Out-Null
Copy-Item .\keys\150-access "$d\150-access"
icacls "$d\150-access" /inheritance:r /grant:r "$($env:USERNAME):(R)"

# ② 配置
Get-Content .\ssh\config.snippet | Add-Content "$d\config"

# ③ 连
ssh -i "$d\150-access" relay150
```

**自检**：`powershell -ExecutionPolicy Bypass -File .\check-150.ps1`

> 没有 ssh 命令：设置 → 应用 → 可选功能 → 添加「OpenSSH 客户端」。

---

## 3. 把这套 skill 交给 AI 用（可选）

`SKILL.md` + `references/` + `scripts/` 就是完整的 `mesh-network` skill，标准 skill 目录格式。

- **DSH**：整个文件夹拷进 `~/.dsh/skills/mesh-network/`（桌面版也可放 profile 的 skills 目录）
- **Claude Code**：放 `~/.claude/skills/mesh-network/`
- **只想给人看**：直接读 `SKILL.md`，再看 `references/topology.md`（拓扑/地址表）和 `references/troubleshooting.md`（排障）

`scripts/` 里是 Mac 本机在用的运维脚本：

- `verify-network.sh` 通用（ping + ssh 巡检）
- `join-linux-peer.sh` Linux 分机接入 WG 时用
- `vpn-off.sh`、`install-mac-autostart.sh` 是 **macOS 专用**（`scutil` / launchd）

新机器上跑 `verify-network.sh` 时，`10.88.0.5`（Mac）和 `10.88.0.6`（Windows）两个 WG 节点不通是正常的——那是别的机器的内网 IP。

---

## 4. 安全须知（重要）

- `keys/150-access` 是一把**无口令的 root 私钥**。它**只能进 150**，进不了 124/49（已实测 `Permission denied`）。
- 别把它传到公网、别提交进 Git、别丢在共享盘里长期放着。拷到目标机、验证连通后，本包可以删。
- 钥匙注释：`150-access-otherpc-20261121`
  指纹：`SHA256:C+kTTXz3UQ3dgPiV9h8TetPWo+3iWQrcEpIQjo/nnok`
- **随时吊销**（任意一台能进 150 的机器上执行）：

  ```bash
  ssh relay150 "sed -i '/150-access-otherpc-20261121/d' /root/.ssh/authorized_keys"
  ```

  吊销后本包里的私钥立即作废。
- 需要新钥匙时按同样方式重做：`ssh-keygen -t ed25519 -C "150-access-<机器名>-<日期>"`，公钥追加到 150 的 `/root/.ssh/authorized_keys`。

---

## 5. 排障

| 现象 | 处理 |
|---|---|
| `Permission denied (publickey)` | 钥匙没放对或权限太松：`chmod 600`；确认用户是 `root` |
| `Connection timed out` / `No route to host` | 本机网络问题；**或本机开了 VPN 抢默认路由**（速博士等），先断开再连 |
| ping 通但 22 不通 | 安全组/防火墙，或本机出口被封 |
| 想连 124/49 但直连不通 | 用 `ssh gt124-via150` / `ssh jinnuo49-via150`（经 150 中转） |
| 三台服务器同时全断 | 见 `SKILL.md` 第 0.1 节：多半是本机 VPN 连上了 |
| 忘了 22 以外的端口 | 150 上还有一个 `22022` 的 sshd，绑定在 `127.0.0.1`，只能从 150 本机访问 |

---

## 6. 文件清单

```
150-server-skill/
├── README.md              ← 本文件，先读它
├── SKILL.md               ← mesh-network skill 正文（结论/决策树/命令速查）
├── check-150.sh           ← macOS/Linux 连通性自检
├── check-150.ps1          ← Windows 连通性自检
├── keys/
│   ├── 150-access         ← 专用私钥（600，无口令）
│   └── 150-access.pub     ← 对应公钥
├── ssh/
│   ├── config.snippet     ← 追加到 ~/.ssh/config 的配置
│   └── known_hosts-150    ← 150 的主机公钥（免首次确认）
├── references/
│   ├── topology.md        ← 拓扑、地址表、WG 参数、时间线
│   └── troubleshooting.md ← 分通道排障
└── scripts/
    ├── vpn-off.sh                 ← 断开速博士 VPN 并等组网恢复
    ├── verify-network.sh          ← 三台直连 + WG 五节点 + 中转策略巡检
    ├── install-mac-autostart.sh   ← macOS WG 守护自启安装
    └── join-linux-peer.sh         ← Linux 分机接入 WG
```
