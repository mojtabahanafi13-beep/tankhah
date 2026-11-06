# Silent installer step used by Tankhah-Setup.exe (runs as Administrator). Own scheduled task + firewall rule for port 8795 only.
$ErrorActionPreference = 'Continue'
$Port = 8795
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Sup  = Join-Path $Here 'tankhah-supervisor.ps1'
$Root = Split-Path -Parent $Here
$log = Join-Path $Root 'logs'; New-Item -ItemType Directory -Path $log -Force | Out-Null
Start-Transcript -Path (Join-Path $log 'install.log') -Force | Out-Null
$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Sup`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$tBoot = New-ScheduledTaskTrigger -AtStartup; $tBoot.Delay = 'PT60S'
$tRep  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName 'Tankhah-Supervisor' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'Tankhah-Supervisor' -Action $action -Trigger @($tBoot, $tRep) -Settings $settings -Principal $principal -Description 'Keeps the Tankhah petty-cash app running' | Out-Null
if (-not (Get-NetFirewallRule -DisplayName "Tankhah-$Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Tankhah-$Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private | Out-Null
}
Start-ScheduledTask -TaskName 'Tankhah-Supervisor'
Stop-Transcript | Out-Null
exit 0
