#ifndef PublishDir
  #error PublishDir must point to a validated self-contained scanner helper publish folder
#endif

[Setup]
AppId=MTGArchives.ScannerAgent
AppName=MTG Archives Scanner Helper
AppVersion=0.3.5
AppPublisher=MTG Archives
DefaultDirName={localappdata}\Programs\MTG Archives Scanner Helper
DefaultGroupName=MTG Archives Scanner Helper
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=MTGArchivesScannerSetup
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\Mtg.ScannerAgent.exe
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: autostart; Description: "Keep my scanner available when I sign in"; Flags: checkedonce

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\MTG Archives Scanner Helper"; Filename: "{app}\Mtg.ScannerAgent.exe"

[Registry]
Root: HKCU; Subkey: "Software\Classes\mtg-archive-scanner"; ValueType: string; ValueData: "URL:MTG Archives Scanner Connection"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\mtg-archive-scanner"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\mtg-archive-scanner\shell\open\command"; ValueType: string; ValueData: """{app}\Mtg.ScannerAgent.exe"" pair-uri ""%1"""
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MTG Archives Scanner Helper"; ValueData: """{app}\Mtg.ScannerAgent.exe"" resume"; Tasks: autostart; Flags: uninsdeletevalue
