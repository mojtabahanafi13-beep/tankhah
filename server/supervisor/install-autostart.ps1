# One-time installer for the Tankhah app (separate from Anbar). Creates its own scheduled task "Tankhah-Supervisor" and a firewall rule for port 8795 only.
# It does NOT change power settings, other ports, Caddy, Cloudflared or the Anbar task.
$ErrorActionPreference = 'Stop'
trap { Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
$Port = 8795
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Please run install-autostart.bat as Administrator.' -ForegroundColor Red; Read-Host 'Enter to exit'; exit 1
}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Sup  = Join-Path $Here 'tankhah-supervisor.ps1'
$Root = Split-Path -Parent $Here
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -and -not (Test-Path 'C:\Program Files\nodejs\node.exe')) { Write-Host 'Node.js not found (version 22.5 or newer is required).' -ForegroundColor Red; Read-Host 'Enter'; exit 1 }

# refuse to continue if another program already owns the port
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
    $ok = $false
    try { $ok = ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5).Content -match 'tankhah') } catch {}
    if (-not $ok) { Write-Host "Port $Port is used by another program. Nothing was changed. Edit `$Port in the two .ps1 files to use a free port." -ForegroundColor Red; Read-Host 'Enter'; exit 1 }
}

Write-Host "Tankhah folder: $Root"
$hasPw = Read-Host 'Does this Windows account have a password? (Y = yes / N = no password)'
$useSystem = ($hasPw -match '^[nN]')
if (-not $useSystem) {
    $cred = Get-Credential -UserName $id.Name -Message 'Windows password of this account (stored by Windows Task Scheduler only)'
    $user = $cred.UserName; $pass = $cred.GetNetworkCredential().Password
    if ([string]::IsNullOrEmpty($pass)) { Write-Host 'Empty password -> using SYSTEM mode.'; $useSystem = $true }
}

$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Sup`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$tBoot = New-ScheduledTaskTrigger -AtStartup; $tBoot.Delay = 'PT60S'
$tRep  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)

Unregister-ScheduledTask -TaskName 'Tankhah-Supervisor' -Confirm:$false -ErrorAction SilentlyContinue
if ($useSystem) {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName 'Tankhah-Supervisor' -Action $action -Trigger @($tBoot, $tRep) -Settings $settings -Principal $principal -Description 'Keeps the Tankhah petty-cash app running' | Out-Null
} else {
    Register-ScheduledTask -TaskName 'Tankhah-Supervisor' -Action $action -Trigger @($tBoot, $tRep) -Settings $settings -User $user -Password $pass -RunLevel Highest -Description 'Keeps the Tankhah petty-cash app running' | Out-Null
}
Write-Host 'Scheduled task "Tankhah-Supervisor" created.' -ForegroundColor Green

if (-not (Get-NetFirewallRule -DisplayName "Tankhah-$Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Tankhah-$Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private | Out-Null
    Write-Host "Firewall rule Tankhah-$Port added (private/domain networks)." -ForegroundColor Green
}

Start-ScheduledTask -TaskName 'Tankhah-Supervisor'
Write-Host 'Started. Waiting for the app...'
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep -Seconds 2
    try { $ok = ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5).Content -match 'tankhah') } catch {}
}
if ($ok) {
    Write-Host "OK: Tankhah answers on http://127.0.0.1:$Port" -ForegroundColor Green
    try { Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' } | ForEach-Object { Write-Host ("From other devices on the network: http://{0}:{1}" -f $_.IPAddress, $Port) } } catch {}
} else { Write-Host "App did not answer yet - check $Root\logs\supervisor.log and server.err.log" -ForegroundColor Yellow }
Read-Host 'Done. Press Enter'
