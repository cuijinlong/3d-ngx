# 检查本机到 150 中转机的连通性（Windows PowerShell）
# 用法：powershell -ExecutionPolicy Bypass -File check-150.ps1
$IP = "150.158.41.155"

Write-Host "① ping $IP ..."
if (Test-Connection -ComputerName $IP -Count 2 -Quiet) { Write-Host "   OK 通" } else { Write-Host "   FAIL 不通（先查本机网络/VPN）" }

Write-Host "② 端口 22 ..."
if (Test-NetConnection -ComputerName $IP -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue) { Write-Host "   OK 22 开放" } else { Write-Host "   FAIL 22 连不上" }

Write-Host "③ SSH 登录 ..."
$out = & ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new root@$IP "hostname" 2>&1
if ($out -match "VM-0-16-ubuntu") { Write-Host "   OK 已连通"; $out } else { Write-Host "   FAIL 失败：$out"; Write-Host "   钥匙没登记？把本机 C:\Users\$env:USERNAME\.ssh\id_ed25519.pub 追加到 150 的 /root/.ssh/authorized_keys" }
