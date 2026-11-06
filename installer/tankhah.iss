#define AppVer GetEnv("APP_VERSION")
[Setup]
AppId={{7B1D6C2E-4A55-4F7B-9E21-00A1B2C3D4E5}
AppName=Tankhah (Rojin Petty Cash)
AppVersion={#AppVer}
AppPublisher=Rojin
DefaultDirName=C:\Tankhah
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
OutputDir=out
OutputBaseFilename=Tankhah-Setup
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\public\icon-192.png
WizardStyle=modern

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{app}\data"; Flags: uninsneveruninstall
Name: "{app}\logs"; Flags: uninsneveruninstall

[Icons]
Name: "{commondesktop}\Tankhah"; Filename: "http://127.0.0.1:8795/"; IconFilename: "{app}\logo.ico"
Name: "{commonprograms}\Tankhah"; Filename: "http://127.0.0.1:8795/"; IconFilename: "{app}\logo.ico"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\supervisor\install-silent.ps1"""; Flags: runhidden waituntilterminated; StatusMsg: "Starting Tankhah service..."
Filename: "http://127.0.0.1:8795/"; Flags: shellexec postinstall skipifsilent nowait; Description: "Open Tankhah"

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'Tankhah-Supervisor' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Tankhah-8795' -ErrorAction SilentlyContinue"""; Flags: runhidden; RunOnceId: "RemoveTask"

[Code]
procedure StopTankhah();
var rc: Integer;
begin
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName ''Tankhah-Supervisor'' -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process -Filter ""Name=''node.exe''"" | Where-Object { $_.CommandLine -like ''*Tankhah*server.js*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Get-CimInstance Win32_Process -Filter ""Name=''powershell.exe''"" | Where-Object { $_.CommandLine -like ''*tankhah-supervisor.ps1*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', '', SW_HIDE, ewWaitUntilTerminated, rc);
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopTankhah();
  Result := '';
end;
