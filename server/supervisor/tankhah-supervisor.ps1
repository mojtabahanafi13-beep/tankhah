# Tankhah Supervisor - keeps ONLY the Tankhah app (port 8795) alive.
# Independent from the Anbar supervisor: own scheduled task, own mutex, own logs, own port. It never touches ports 8787/8790, Caddy or Cloudflared.
$ErrorActionPreference = 'Continue'
$Root   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$SupLog = Join-Path $LogDir 'supervisor.log'
$Port   = 8795
$CheckEverySeconds = 15
$FailuresBeforeRestart = 3

function Write-Log([string]$m) {
    try {
        if ((Test-Path $SupLog) -and ((Get-Item $SupLog).Length -gt 5MB)) { Move-Item $SupLog ($SupLog + '.old') -Force }
        Add-Content -Path $SupLog -Value ("{0} {1}" -f (Get-Date -Format 's'), $m)
    } catch {}
}

# single instance
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\TankhahSupervisorMutex', [ref]$created)
if (-not $created) { exit 0 }

$Node = $null
$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($cmd) { $Node = $cmd.Source }
foreach ($p in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) { if (-not $Node -and (Test-Path $p)) { $Node = $p } }
if (-not $Node) { Write-Log 'FATAL node.exe not found'; exit 1 }

$env:PORT = "$Port"
$env:DATA_DIR = Join-Path $Root 'data'
Write-Log "supervisor started; node=$Node root=$Root port=$Port"

# healthy only if the answer really comes from Tankhah (never mistake another app on the port for ours)
function Test-Health {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 8
        return ($r.StatusCode -eq 200 -and $r.Content -match 'tankhah')
    } catch { return $false }
}
function Rotate([string]$f) { try { if ((Test-Path $f) -and ((Get-Item $f).Length -gt 10MB)) { Move-Item $f ($f + '.old') -Force } } catch {} }

$script:proc = $null
function Start-Tankhah {
    if (Test-Health) {
        try {
            $ownerPid = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
            if ($ownerPid) { $script:proc = Get-Process -Id $ownerPid -ErrorAction Stop; Write-Log "adopted healthy instance pid=$ownerPid"; return }
        } catch {}
    }
    # port busy but not answering as Tankhah: only kill it if it is a stale process of THIS folder; otherwise leave it alone
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $ci = $null
        try { $ci = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue } catch {}
        if ($ci -and $ci.CommandLine -and $ci.CommandLine -like "*$Root*server.js*" -and $ci.ExecutablePath -like '*node.exe') {
            Write-Log "port $Port held by a non-answering node process pid=$($listener.OwningProcess); stopping it"
            try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
            Start-Sleep -Seconds 2
        } else {
            Write-Log "port $Port is used by another program (pid=$($listener.OwningProcess)); NOT touching it. Change `$Port in this script and in the firewall rule if needed."
            return
        }
    }
    $out = Join-Path $LogDir 'server.out.log'; $err = Join-Path $LogDir 'server.err.log'
    Rotate $out; Rotate $err
    try {
        $p = Start-Process -FilePath $Node -ArgumentList @('--no-warnings', ('"' + (Join-Path $Root 'server.js') + '"')) -WorkingDirectory $Root `
             -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
        $script:proc = $p
        Write-Log "started server pid=$($p.Id)"
        for ($w = 0; $w -lt 20; $w++) { Start-Sleep -Seconds 1; if (Test-Health) { Write-Log "server answered after ${w}s"; break } }
    } catch { Write-Log "ERROR starting server: $($_.Exception.Message)" }
}

Start-Tankhah
$fail = 0
while ($true) {
    try {
        if (Test-Health) { $fail = 0 }
        else {
            $fail++
            $alive = $script:proc -and -not $script:proc.HasExited
            if (-not $alive) { Write-Log 'server is not running; restarting'; Start-Tankhah; $fail = 0; Start-Sleep -Seconds 5 }
            elseif ($fail -ge $FailuresBeforeRestart) {
                Write-Log "server not answering ($fail checks); restarting"
                try { $script:proc.Kill() } catch {}
                Start-Sleep -Seconds 2
                Start-Tankhah; $fail = 0; Start-Sleep -Seconds 5
            }
        }
    } catch { Write-Log "loop error: $($_.Exception.Message)" }
    Start-Sleep -Seconds $CheckEverySeconds
}
