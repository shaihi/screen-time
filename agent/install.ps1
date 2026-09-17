param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$IngestSecret,
    [string]$DeviceId = "family-pc"
)

$ErrorActionPreference = "Stop"
$projectPath = Join-Path $PSScriptRoot "ScreenTime.Agent\ScreenTime.Agent.csproj"
$publishPath = Join-Path $PSScriptRoot "ScreenTime.Agent\publish"
$installPath = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent"

dotnet publish $projectPath -c Release -r win-x64 --self-contained true -o $publishPath
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
Copy-Item (Join-Path $publishPath "ScreenTime.Agent.exe") $installPath -Force

$config = @{
    ApiUrl = $ApiUrl
    IngestSecret = $IngestSecret
    DeviceId = $DeviceId
    IdleThresholdSeconds = 120
    SampleIntervalSeconds = 5
    UploadIntervalMinutes = 5
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $installPath "appsettings.json") -Value $config -Encoding UTF8

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Screen Time Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installPath "ScreenTime.Agent.exe"
$shortcut.WorkingDirectory = $installPath
$shortcut.Description = "Screen Time monitoring agent"
$shortcut.Save()

Start-Process -FilePath (Join-Path $installPath "ScreenTime.Agent.exe")
Write-Host "Installed. The agent is running in the notification tray and will start at sign-in."
