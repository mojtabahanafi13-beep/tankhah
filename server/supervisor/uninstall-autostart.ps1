# Removes ONLY Tankhah: its scheduled task, its firewall rule and the process on port 8795. Anbar is not touched. Data folder is kept.
$Port = 8795
Unregister-ScheduledTask -TaskName 'Tankhah-Supervisor' -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Tankhah-$Port" -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force } catch {} }
Write-Host 'Tankhah autostart removed. The data folder was kept.'
Read-Host 'Press Enter'
