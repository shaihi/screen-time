param(
    [string]$ApiUrl,
    [string]$IngestSecret,
    [string]$DeviceId
)

$ErrorActionPreference = "Stop"
$projectPath = Join-Path $PSScriptRoot "ScreenTime.Agent\ScreenTime.Agent.csproj"
$publishPath = Join-Path $PSScriptRoot "ScreenTime.Agent\publish"
$installPath = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent"
$configPath = Join-Path $installPath "appsettings.json"

# Re-installs keep the existing settings unless new values are passed.
$existing = $null
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}
if (-not $ApiUrl -and $existing) { $ApiUrl = $existing.ApiUrl }
if (-not $IngestSecret -and $existing) { $IngestSecret = $existing.IngestSecret }
if (-not $DeviceId) { $DeviceId = if ($existing) { $existing.DeviceId } else { "family-pc" } }
if (-not $ApiUrl -or -not $IngestSecret) {
    throw "ApiUrl and IngestSecret are required for a first install."
}

$dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
if ($dotnetCommand) {
    $dotnetPath = $dotnetCommand.Source
} else {
    $portableDotnet = Join-Path $PSScriptRoot "..\.tools\dotnet\dotnet.exe"
    if (-not (Test-Path -LiteralPath $portableDotnet)) {
        throw "The .NET 8 SDK is required to build the agent. Install it from https://dotnet.microsoft.com/download/dotnet/8.0"
    }
    $dotnetPath = (Resolve-Path -LiteralPath $portableDotnet).Path
}

& $dotnetPath publish $projectPath -c Release -r win-x64 --self-contained true -o $publishPath
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

# The running agent locks its executable; stop it before copying the new build.
$running = Get-Process -Name "ScreenTime.Agent" -ErrorAction SilentlyContinue
if ($running) {
    $running | Stop-Process -Force
    $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $installPath -Force | Out-Null
Copy-Item (Join-Path $publishPath "ScreenTime.Agent.exe") $installPath -Force

$config = [ordered]@{
    ApiUrl = $ApiUrl
    IngestSecret = $IngestSecret
    DeviceId = $DeviceId
    IdleThresholdSeconds = 120
    SampleIntervalSeconds = 2
    UploadIntervalMinutes = 1
} | ConvertTo-Json
Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Screen Time Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installPath "ScreenTime.Agent.exe"
$shortcut.WorkingDirectory = $installPath
$shortcut.Description = "Screen Time monitoring agent"
$shortcut.Save()

Start-Process -FilePath (Join-Path $installPath "ScreenTime.Agent.exe") -WindowStyle Hidden
Write-Host "Installed. The agent is running in the notification tray and will start at sign-in."
