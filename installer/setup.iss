; ─────────────────────────────────────────────────────────────────────────────
; Recording Agent — Inno Setup Installer Script
;
; Builds a single RecordingAgentSetup.exe that:
;   1. Shows a wizard with server URL / agent ID configuration
;   2. Installs the self-contained .NET 8 agent to Program Files
;   3. Bundles ffmpeg.exe (no separate FFmpeg install needed)
;   4. Creates the local 24-hour buffer directory
;   5. Adds the agent to Windows Startup (current user)
;   6. Starts the agent immediately after installation
;
; Build prerequisites (see build.ps1):
;   - Inno Setup 6  (iscc.exe on PATH or at default install location)
;   - publish\      dotnet publish output (self-contained win-x64)
;   - tools\        ffmpeg.exe + ffprobe.exe
; ─────────────────────────────────────────────────────────────────────────────

#define AppName    "Recording Agent"
#define AppVersion "1.0.0"
#define AppPublisher "RecordingSystem"
#define AppExeName "RecordingAgent.exe"
#define AppDataDir "{commonappdata}\RecordingAgent"

[Setup]
AppId={{D4A2B3C1-8E5F-4A9D-B6C2-1F3E7A8D2B4C}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\RecordingAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=RecordingAgentSetup
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
WizardStyle=modern
WizardResizable=no
UninstallDisplayIcon={app}\{#AppExeName}
CloseApplications=yes

; Minimum Windows version: Windows 10 (DXGI Desktop Duplication works from Win 8+)
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Agent — self-contained .NET 8 publish output
Source: "publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

; Bundled FFmpeg binaries (no external dependency)
Source: "tools\ffmpeg.exe";  DestDir: "{app}"; Flags: ignoreversion
Source: "tools\ffprobe.exe"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Create buffer directory structure with correct permissions
Name: "{commonappdata}\RecordingAgent\buffer\segments"; Permissions: users-full

[Icons]
; No desktop shortcut — background process

[Registry]
; Add to Windows Startup for the installing user (runs in desktop session — required for DXGI)
Root: HKCU; \
  Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; \
  ValueName: "RecordingAgent"; \
  ValueData: """{app}\{#AppExeName}"""; \
  Flags: uninsdeletevalue

[UninstallRun]
; Kill the agent before uninstalling
Filename: "taskkill.exe"; Parameters: "/F /IM {#AppExeName}"; Flags: runhidden; RunOnceId: "KillAgent"

; ─────────────────────────────────────────────────────────────────────────────
; Custom wizard pages and post-install configuration
; ─────────────────────────────────────────────────────────────────────────────
[Code]

var
  ConfigPage: TInputQueryWizardPage;

// ── Wizard pages ─────────────────────────────────────────────────────────────

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(
    wpSelectDir,
    'Server Configuration',
    'Connect this agent to the Recording Server',
    'Enter the addresses of your Recording Server. You can change these later in appsettings.json.');

  ConfigPage.Add('Recording Server URL:', False);
  ConfigPage.Add('Media Server URL (RTSP/WebRTC):', False);
  ConfigPage.Add('Agent ID (leave empty to use computer name):', False);

  // Sensible defaults
  ConfigPage.Values[0] := 'http://192.168.1.10';
  ConfigPage.Values[1] := 'rtsp://192.168.1.10:8554';
  ConfigPage.Values[2] := '';
end;

// ── Input validation ──────────────────────────────────────────────────────────

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = ConfigPage.ID then
  begin
    if Trim(ConfigPage.Values[0]) = '' then
    begin
      MsgBox('Please enter the Recording Server URL.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Trim(ConfigPage.Values[1]) = '' then
    begin
      MsgBox('Please enter the Media Server URL.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

// ── Config file patching ──────────────────────────────────────────────────────

procedure PatchConfig;
var
  ConfigPath: String;
  Content: AnsiString;
  ServerUrl, MediaServerUrl, AgentId, FfmpegPath: String;
begin
  ConfigPath   := ExpandConstant('{app}\appsettings.json');
  ServerUrl    := Trim(ConfigPage.Values[0]);
  MediaServerUrl := Trim(ConfigPage.Values[1]);
  AgentId      := Trim(ConfigPage.Values[2]);
  FfmpegPath   := ExpandConstant('{app}\ffmpeg.exe');

  // Replace backslashes for JSON (Windows paths need \\)
  StringChange(FfmpegPath, '\', '\\');

  if not LoadStringFromFile(ConfigPath, Content) then
  begin
    MsgBox('Failed to read appsettings.json — configuration was not updated.', mbError, MB_OK);
    Exit;
  end;

  // Patch each placeholder value
  StringChange(Content, '"ServerUrl": "http://localhost"',
                         '"ServerUrl": "' + ServerUrl + '"');
  StringChange(Content, '"MediaServerUrl": "rtsp://localhost:8554"',
                         '"MediaServerUrl": "' + MediaServerUrl + '"');
  StringChange(Content, '"FfmpegPath": "ffmpeg"',
                         '"FfmpegPath": "' + FfmpegPath + '"');
  StringChange(Content, '"BufferPath": "C:\\\\ProgramData\\\\RecordingAgent\\\\buffer"',
                         '"BufferPath": "C:\\\\ProgramData\\\\RecordingAgent\\\\buffer"');

  // Set AgentId only if the user provided one; otherwise leave empty (defaults to MachineName)
  if AgentId <> '' then
    StringChange(Content, '"AgentId": ""', '"AgentId": "' + AgentId + '"');

  if not SaveStringToFile(ConfigPath, Content, False) then
    MsgBox('Failed to write appsettings.json — configuration was not saved.', mbError, MB_OK);
end;

// ── Post-install: patch config then launch agent ──────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    PatchConfig;

    // Launch the agent immediately in the current user's desktop session
    if not ShellExec('', ExpandConstant('{app}\{#AppExeName}'), '',
                     ExpandConstant('{app}'), SW_HIDE, ewNoWait, ResultCode) then
      MsgBox('Installation complete. The agent will start automatically on next login.',
             mbInformation, MB_OK);
  end;
end;
