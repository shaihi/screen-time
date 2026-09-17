param(
    [switch]$SkipPull
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE."
    }
}

Push-Location $repoRoot
try {
    if (-not $SkipPull) {
        $changes = git status --porcelain
        if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the Git worktree." }
        if ($changes) { throw "The Git worktree is not clean. Commit or stash changes before updating." }
        Invoke-Checked "git" @("fetch", "origin", "main")
        Invoke-Checked "git" @("checkout", "main")
        Invoke-Checked "git" @("pull", "--ff-only", "origin", "main")
    }

    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($dotnetCommand) {
        $dotnetPath = $dotnetCommand.Source
    } else {
        $portableDotnet = Join-Path $repoRoot ".tools\dotnet\dotnet.exe"
        if (-not (Test-Path -LiteralPath $portableDotnet)) {
            throw "The .NET 8 SDK is required."
        }
        $dotnetPath = (Resolve-Path -LiteralPath $portableDotnet).Path
    }

    Invoke-Checked $dotnetPath @("test", "agent\ScreenTime.Agent.Tests\ScreenTime.Agent.Tests.csproj")
    Invoke-Checked $dotnetPath @("build", "agent\ScreenTime.Agent\ScreenTime.Agent.csproj", "-c", "Release")
    & (Join-Path $PSScriptRoot "install.ps1")

    $installedExe = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent\ScreenTime.Agent.exe"
    $processes = @(Get-Process -Name "ScreenTime.Agent" -ErrorAction Stop | Where-Object Path -EQ $installedExe)
    if ($processes.Count -ne 1) { throw "Post-install verification found $($processes.Count) installed agent processes." }
    $settingsPath = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent\appsettings.json"
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $commit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve the installed Git commit." }

    [pscustomobject]@{
        Commit = $commit
        ProcessId = $processes[0].Id
        StartedAt = $processes[0].StartTime
        Executable = $processes[0].Path
        SampleIntervalSeconds = $settings.SampleIntervalSeconds
        UploadIntervalMinutes = $settings.UploadIntervalMinutes
        CollectPageTitles = $settings.CollectPageTitles
    } | Format-List
} finally {
    Pop-Location
}
