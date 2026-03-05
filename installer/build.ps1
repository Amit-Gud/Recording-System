<#
.SYNOPSIS
    Builds RecordingAgentSetup.exe — a single self-contained Windows installer.

.DESCRIPTION
    Steps:
      1. Publishes the .NET 8 agent as a self-contained win-x64 binary
      2. Downloads FFmpeg essentials (ffmpeg.exe + ffprobe.exe)
      3. Compiles setup.iss with Inno Setup → dist\RecordingAgentSetup.exe

.REQUIREMENTS
    - Windows machine with .NET 8 SDK
    - Inno Setup 6  (https://jrsoftware.org/isinfo.php)
    - Internet access (for FFmpeg download, first build only)

.EXAMPLE
    .\build.ps1
    .\build.ps1 -SkipFfmpegDownload   # if tools\ already has ffmpeg.exe
#>

param(
    [switch] $SkipFfmpegDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot    = Split-Path $PSScriptRoot -Parent
$AgentDir    = Join-Path $RepoRoot "agent\RecordingAgent"
$PublishDir  = Join-Path $PSScriptRoot "publish"
$ToolsDir    = Join-Path $PSScriptRoot "tools"
$DistDir     = Join-Path $PSScriptRoot "dist"

# ── Locate Inno Setup compiler ─────────────────────────────────────────────────
function Find-Iscc {
    $candidates = @(
        "iscc",
        "${env:ProgramFiles(x86)}\Inno Setup 6\iscc.exe",
        "${env:ProgramFiles}\Inno Setup 6\iscc.exe"
    )
    foreach ($c in $candidates) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { return $c }
    }
    return $null
}

$iscc = Find-Iscc
if (-not $iscc) {
    Write-Error @"
Inno Setup 6 not found.
Download and install it from: https://jrsoftware.org/isdl.php
Then re-run this script.
"@
}

# ── Step 1: Publish .NET agent ─────────────────────────────────────────────────
Write-Host "`n[1/3] Publishing .NET agent..." -ForegroundColor Cyan

if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
New-Item -ItemType Directory -Path $PublishDir | Out-Null

dotnet publish "$AgentDir\RecordingAgent.csproj" `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    --output $PublishDir `
    /p:PublishSingleFile=false `
    /p:PublishTrimmed=false

if ($LASTEXITCODE -ne 0) { Write-Error "dotnet publish failed" }
Write-Host "[1/3] Publish complete → $PublishDir" -ForegroundColor Green

# ── Step 2: Download FFmpeg ────────────────────────────────────────────────────
Write-Host "`n[2/3] Preparing FFmpeg..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null

if (-not $SkipFfmpegDownload) {
    $ffmpegZip  = Join-Path $ToolsDir "ffmpeg.zip"
    $ffmpegTemp = Join-Path $ToolsDir "ffmpeg-temp"

    Write-Host "    Downloading FFmpeg essentials build..."

    # FFmpeg essentials build from gyan.dev (static win64 build, ~80 MB)
    $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing

    Write-Host "    Extracting..."
    if (Test-Path $ffmpegTemp) { Remove-Item $ffmpegTemp -Recurse -Force }
    Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegTemp

    # The zip contains a single versioned subfolder, e.g. ffmpeg-7.1-essentials_build\
    $binDir = Get-ChildItem -Path $ffmpegTemp -Filter "bin" -Recurse -Directory |
              Select-Object -First 1

    if (-not $binDir) { Write-Error "Could not find bin\ inside the FFmpeg zip" }

    Copy-Item (Join-Path $binDir.FullName "ffmpeg.exe")  $ToolsDir -Force
    Copy-Item (Join-Path $binDir.FullName "ffprobe.exe") $ToolsDir -Force

    Remove-Item $ffmpegZip  -Force
    Remove-Item $ffmpegTemp -Recurse -Force

    Write-Host "    FFmpeg ready in $ToolsDir" -ForegroundColor Green
} else {
    if (-not (Test-Path (Join-Path $ToolsDir "ffmpeg.exe"))) {
        Write-Error "tools\ffmpeg.exe not found. Run without -SkipFfmpegDownload to download it."
    }
    Write-Host "    Using existing FFmpeg in $ToolsDir" -ForegroundColor Yellow
}

# ── Step 3: Compile installer ─────────────────────────────────────────────────
Write-Host "`n[3/3] Compiling installer with Inno Setup..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

& $iscc (Join-Path $PSScriptRoot "setup.iss")
if ($LASTEXITCODE -ne 0) { Write-Error "Inno Setup compilation failed" }

$output = Join-Path $DistDir "RecordingAgentSetup.exe"
$size   = [math]::Round((Get-Item $output).Length / 1MB, 1)

Write-Host "`n✓ Installer ready: $output ($size MB)" -ForegroundColor Green
Write-Host "  Deploy this single file to any Windows 10+ endpoint.`n"
