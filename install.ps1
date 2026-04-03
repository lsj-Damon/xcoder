#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$RepoUrl = 'https://github.com/lsj-Damon/xcoder.git',
  [string]$InstallDir = (Join-Path $HOME 'free-code'),
  [string]$BinDir = (Join-Path $HOME 'bin'),
  [string]$BunMinVersion = '1.3.11',
  [string]$Branch = 'main',
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
  Write-Host "[*] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[+] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  throw $Message
}

function Invoke-Step([string]$Description, [scriptblock]$Action) {
  if ($DryRun) {
    Write-Info "[dry-run] $Description"
    return
  }

  Write-Info $Description
  & $Action
}

function Get-ExecutablePath([string[]]$Names) {
  foreach ($Name in $Names) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $Command) {
      if ($Command.Source) {
        return $Command.Source
      }
      if ($Command.Path) {
        return $Command.Path
      }
      if ($Command.Definition) {
        return $Command.Definition
      }
    }
  }

  return $null
}

function Normalize-Version([string]$Version) {
  $Match = [regex]::Match($Version, '\d+(\.\d+){0,3}')
  if (-not $Match.Success) {
    return $null
  }

  return [version]$Match.Value
}

function Test-VersionGte([string]$Actual, [string]$Minimum) {
  $ActualVersion = Normalize-Version $Actual
  $MinimumVersion = Normalize-Version $Minimum

  if ($null -eq $ActualVersion -or $null -eq $MinimumVersion) {
    return $false
  }

  return $ActualVersion -ge $MinimumVersion
}

function Add-DirectoryToUserPath([string]$Directory) {
  $FullPath = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
  $CurrentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $Entries = @()

  if (-not [string]::IsNullOrWhiteSpace($CurrentUserPath)) {
    $Entries = $CurrentUserPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  $AlreadyPresent = $false
  foreach ($Entry in $Entries) {
    if ($Entry.TrimEnd('\').Equals($FullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      $AlreadyPresent = $true
      break
    }
  }

  if (-not $AlreadyPresent) {
    $NewUserPath = if ($Entries.Count -gt 0) {
      ($Entries + $FullPath) -join ';'
    } else {
      $FullPath
    }

    [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
    Write-Ok "Added to user PATH: $FullPath"
  }

  $SessionEntries = @()
  if (-not [string]::IsNullOrWhiteSpace($env:Path)) {
    $SessionEntries = $env:Path.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  $SessionHasEntry = $false
  foreach ($Entry in $SessionEntries) {
    if ($Entry.TrimEnd('\').Equals($FullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      $SessionHasEntry = $true
      break
    }
  }

  if (-not $SessionHasEntry) {
    $env:Path = if ([string]::IsNullOrWhiteSpace($env:Path)) {
      $FullPath
    } else {
      "$FullPath;$env:Path"
    }
  }
}

function Invoke-CommandChecked([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

function Get-GitBashPath([string]$GitPath) {
  if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CODE_GIT_BASH_PATH)) {
    if (Test-Path -LiteralPath $env:CLAUDE_CODE_GIT_BASH_PATH -PathType Leaf) {
      return $env:CLAUDE_CODE_GIT_BASH_PATH
    }

    Fail "CLAUDE_CODE_GIT_BASH_PATH is set but does not exist: $env:CLAUDE_CODE_GIT_BASH_PATH"
  }

  $GitDir = Split-Path -Parent $GitPath
  $GitRoot = Split-Path -Parent $GitDir
  $DerivedBashPath = Join-Path $GitRoot 'bin\bash.exe'

  if (Test-Path -LiteralPath $DerivedBashPath -PathType Leaf) {
    return $DerivedBashPath
  }

  $Fallbacks = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )

  foreach ($Candidate in $Fallbacks) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return $Candidate
    }
  }

  Fail 'Git for Windows is installed, but Git Bash was not found. Install Git for Windows from https://git-scm.com/download/win and ensure bash.exe is available.'
}

function Get-BunPath() {
  $BunPath = Get-ExecutablePath @('bun.exe', 'bun')
  if ($BunPath) {
    return $BunPath
  }

  $DefaultBunPath = Join-Path $HOME '.bun\bin\bun.exe'
  if (Test-Path -LiteralPath $DefaultBunPath -PathType Leaf) {
    return $DefaultBunPath
  }

  return $null
}

function Ensure-Bun() {
  $BunPath = Get-BunPath
  if ($BunPath) {
    $VersionOutput = (& $BunPath --version).Trim()
    if (Test-VersionGte $VersionOutput $BunMinVersion) {
      Write-Ok "bun: v$VersionOutput"
      Add-DirectoryToUserPath (Split-Path -Parent $BunPath)
      return $BunPath
    }

    Write-Warn "bun v$VersionOutput found but v$BunMinVersion or newer is required. Reinstalling..."
  } else {
    Write-Info 'bun not found. Installing...'
  }

  Invoke-Step 'Installing Bun...' {
    $Installer = Invoke-RestMethod -Uri 'https://bun.sh/install.ps1'
    Invoke-Expression $Installer
  }

  $BunBin = Join-Path $HOME '.bun\bin'
  if (-not $DryRun -and (Test-Path -LiteralPath $BunBin -PathType Container)) {
    Add-DirectoryToUserPath $BunBin
  }

  $ResolvedBunPath = if ($DryRun) {
    Join-Path $BunBin 'bun.exe'
  } else {
    Get-BunPath
  }

  if (-not $ResolvedBunPath) {
    Fail 'bun installation completed, but bun.exe was not found on PATH or in ~/.bun/bin.'
  }

  if (-not $DryRun) {
    $InstalledVersion = (& $ResolvedBunPath --version).Trim()
    if (-not (Test-VersionGte $InstalledVersion $BunMinVersion)) {
      Fail "bun v$InstalledVersion was installed, but v$BunMinVersion or newer is required."
    }
    Write-Ok "bun: v$InstalledVersion"
  } else {
    Write-Ok "bun will be available at $ResolvedBunPath"
  }

  return $ResolvedBunPath
}

function Resolve-BuiltBinary([string]$RootDir) {
  $Candidates = @(
    (Join-Path $RootDir 'cli-dev.exe'),
    (Join-Path $RootDir 'cli-dev'),
    (Join-Path $RootDir 'dist\cli.exe'),
    (Join-Path $RootDir 'dist\cli')
  )

  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return $Candidate
    }
  }

  return $null
}

function Write-Launcher([string]$BinaryPath) {
  Invoke-Step "Creating launcher in $BinDir..." {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $LauncherPath = Join-Path $BinDir 'free-code.cmd'
    $Launcher = @"
@echo off
setlocal
if exist "$BinaryPath" (
  "$BinaryPath" %*
  exit /b %ERRORLEVEL%
)
echo free-code binary not found at "$BinaryPath".
echo Re-run the installer or build the project again.
exit /b 1
"@

    Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding Ascii
    Add-DirectoryToUserPath $BinDir
    Write-Ok "Launcher created: $LauncherPath"
  }
}

Write-Host ''
Write-Host '   ___                            _' -ForegroundColor Cyan
Write-Host '  / _|_ __ ___  ___        ___ __| | ___' -ForegroundColor Cyan
Write-Host ' | |_| ''__/ _ \/ _ \_____ / __/ _` |/ _ \' -ForegroundColor Cyan
Write-Host ' |  _| | |  __/  __/_____| (_| (_| |  __/' -ForegroundColor Cyan
Write-Host ' |_| |_|  \___|\___|      \___\__,_|\___|' -ForegroundColor Cyan
Write-Host '  The free build of Claude Code' -ForegroundColor DarkGray
Write-Host ''

Write-Info 'Starting Windows installation...'

if ($env:OS -ne 'Windows_NT') {
  Fail 'This installer is for native Windows PowerShell. Use install.sh on macOS or Linux.'
}

$GitPath = Get-ExecutablePath @('git.exe', 'git')
if (-not $GitPath) {
  Fail 'git is not installed. Install Git for Windows first: https://git-scm.com/download/win'
}

$GitVersion = (& $GitPath --version).Trim()
Write-Ok "git: $GitVersion"

$GitBashPath = Get-GitBashPath $GitPath
Write-Ok "git-bash: $GitBashPath"

$BunPath = Ensure-Bun

if (Test-Path -LiteralPath $InstallDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $InstallDir '.git'))) {
    Fail "$InstallDir already exists, but it is not a git repository."
  }

  Invoke-Step "Updating repository in $InstallDir..." {
    & $GitPath -C $InstallDir pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'git pull failed, continuing with the existing checkout.'
    }
  }
} else {
  Invoke-Step "Cloning repository into $InstallDir..." {
    & $GitPath clone --depth 1 --branch $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) {
      Fail 'git clone failed.'
    }
  }
}

if (-not $DryRun) {
  Push-Location $InstallDir
  try {
    Write-Info 'Installing dependencies...'
    & $BunPath install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'bun install --frozen-lockfile failed, retrying with bun install...'
      & $BunPath install
      if ($LASTEXITCODE -ne 0) {
        Fail 'bun install failed.'
      }
    }
    Write-Ok 'Dependencies installed'

    Write-Info 'Building free-code (all experimental features enabled)...'
    & $BunPath run build:dev:full
    if ($LASTEXITCODE -ne 0) {
      Fail 'bun run build:dev:full failed.'
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Info '[dry-run] Installing dependencies with bun install --frozen-lockfile'
  Write-Info '[dry-run] Building free-code with bun run build:dev:full'
}

$BinaryPath = if ($DryRun) {
  Join-Path $InstallDir 'cli-dev.exe'
} else {
  Resolve-BuiltBinary $InstallDir
}

if (-not $BinaryPath) {
  Fail 'Build completed, but no free-code binary was found.'
}

if (-not $DryRun) {
  Write-Ok "Binary built: $BinaryPath"
}

Write-Launcher $BinaryPath

Write-Host ''
Write-Host '  Installation complete!' -ForegroundColor Green
Write-Host ''
Write-Host '  Run it:'
Write-Host '    free-code                          # interactive REPL' -ForegroundColor Cyan
Write-Host '    free-code -p "your prompt"         # one-shot mode' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Set your API key for this session:'
Write-Host '    $env:ANTHROPIC_API_KEY="sk-ant-..."' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Or persist it for future terminals:'
Write-Host '    [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY","sk-ant-...","User")' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Or log in with Claude.ai:'
Write-Host '    free-code /login' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Source: $InstallDir" -ForegroundColor DarkGray
Write-Host "  Binary: $BinaryPath" -ForegroundColor DarkGray
Write-Host "  Link:   $(Join-Path $BinDir 'free-code.cmd')" -ForegroundColor DarkGray
Write-Host ''
Write-Warn 'Some features still require WSL2 or Unix-like environments, including sandboxing and tmux-backed swarms.'
