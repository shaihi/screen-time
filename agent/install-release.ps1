param(
    [string]$ApiUrl,
    [string]$IngestSecret,
    [string]$DeviceId,
    [string]$CleanupRoot = ""
)

# Runs from an extracted release zip next to ScreenTime.Agent.exe.
# No .NET SDK, no git clone, no build step -- this is what the neighbor runs.

$ErrorActionPreference = "Stop"
$installPath = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent"
$configPath = Join-Path $installPath "appsettings.json"
$installedExe = Join-Path $installPath "ScreenTime.Agent.exe"
$sourceExe = Join-Path $PSScriptRoot "ScreenTime.Agent.exe"

function Stop-AgentProcess {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $running = Get-Process -Name "ScreenTime.Agent" -ErrorAction SilentlyContinue
        if (-not $running) { return }
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "ScreenTime.Agent did not stop within 15 seconds."
}

function Wait-FileUnlocked([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        try {
            $stream = [System.IO.File]::Open(
                $Path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None)
            $stream.Dispose()
            return
        } catch [System.IO.IOException] {
            Start-Sleep -Milliseconds 250
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "The installed agent executable remained locked for 15 seconds: $Path"
}

function Install-VerifiedFile([string]$Source, [string]$Destination) {
    $staged = "$Destination.new"
    Copy-Item -LiteralPath $Source -Destination $staged -Force
    $expectedHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "The staged agent executable failed SHA-256 verification."
    }
    Move-Item -LiteralPath $staged -Destination $Destination -Force
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "The installed agent executable failed SHA-256 verification."
    }
}

function Get-ValidatedCleanupRoot([string]$CandidatePath) {
    try {
        if ([string]::IsNullOrWhiteSpace($CandidatePath) -or
            -not [System.IO.Path]::IsPathRooted($CandidatePath)) { return $null }

        $separator = [System.IO.Path]::DirectorySeparatorChar
        $candidate = [System.IO.Path]::GetFullPath($CandidatePath).TrimEnd($separator)
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd($separator)
        $scriptRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd($separator)
        $candidateName = [System.IO.Path]::GetFileName($candidate)
        $isUnderTemp = $candidate.StartsWith(
            "$tempRoot$separator",
            [System.StringComparison]::OrdinalIgnoreCase)
        $scriptIsInsideCandidate = $scriptRoot.StartsWith(
            "$candidate$separator",
            [System.StringComparison]::OrdinalIgnoreCase)

        if ($isUnderTemp -and
            $candidateName -like "ScreenTimeAgent-update-*" -and
            $scriptIsInsideCandidate) { return $candidate }
    } catch { }
    return $null
}

$autoUpdateTempRoot = Get-ValidatedCleanupRoot $CleanupRoot
$transcriptPath = Join-Path $installPath "update-install.log"
$transcriptStarted = $false

try {
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
Start-Transcript -LiteralPath $transcriptPath -Append | Out-Null
$transcriptStarted = $true

if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "ScreenTime.Agent.exe not found next to this script. Re-extract the release zip and run from inside it."
}

$existing = $null
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}
if (-not $ApiUrl -and $existing) { $ApiUrl = $existing.ApiUrl }
if (-not $IngestSecret -and $existing) { $IngestSecret = $existing.IngestSecret }
if (-not $DeviceId) { $DeviceId = if ($existing) { $existing.DeviceId } else { "family-pc" } }
$collectPageTitles = if ($existing -and $existing.PSObject.Properties.Name -contains "CollectPageTitles") {
    [bool]$existing.CollectPageTitles
} else {
    $true
}
if (-not $ApiUrl -or -not $IngestSecret) {
    throw "ApiUrl and IngestSecret are required for a first install. Example:`n  .\install-release.ps1 -ApiUrl https://YOUR-PROJECT.vercel.app/api/ingest -IngestSecret YOUR-SECRET -DeviceId family-pc"
}

Stop-AgentProcess
Wait-FileUnlocked $installedExe
Install-VerifiedFile $sourceExe $installedExe

$config = [ordered]@{
    ApiUrl = $ApiUrl
    IngestSecret = $IngestSecret
    DeviceId = $DeviceId
    IdleThresholdSeconds = 120
    SampleIntervalSeconds = 2
    UploadIntervalMinutes = 1
    CollectPageTitles = $collectPageTitles
} | ConvertTo-Json
Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Screen Time Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExe
$shortcut.WorkingDirectory = $installPath
$shortcut.Description = "Screen Time monitoring agent"
$shortcut.Save()

$started = Start-Process -FilePath $installedExe -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$started.Refresh()
if ($started.HasExited) { throw "The installed agent exited immediately with code $($started.ExitCode)." }
$installedProcesses = @(Get-Process -Name "ScreenTime.Agent" -ErrorAction SilentlyContinue | Where-Object Path -EQ $installedExe)
if ($installedProcesses.Count -ne 1) {
    throw "Expected exactly one installed ScreenTime.Agent process; found $($installedProcesses.Count)."
}
Write-Host "Installed. The agent is running in the notification tray and will start at sign-in."
Write-Host "Windows may show an 'unrecognized publisher' warning the first time -- click 'More info' then 'Run anyway'. This is expected for an unsigned, self-published tool."
} finally {
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
    if ($autoUpdateTempRoot -and (Test-Path -LiteralPath $autoUpdateTempRoot)) {
        try {
            Set-Location ([System.IO.Path]::GetTempPath())
            Remove-Item -LiteralPath $autoUpdateTempRoot -Recurse -Force
        } catch {
            try {
                Add-Content -LiteralPath $transcriptPath -Value "Temp cleanup failed: $($_.Exception.Message)"
            } catch { }
        }
    }
}
