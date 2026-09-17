$ErrorActionPreference = "Stop"
$installPath = Join-Path $env:LOCALAPPDATA "ScreenTimeAgent"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Screen Time Agent.lnk"

Get-Process "ScreenTime.Agent" -ErrorAction SilentlyContinue | Stop-Process
Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $installPath) { Remove-Item -LiteralPath $installPath -Recurse -Force }
Write-Host "Screen Time Agent and its local queued data were removed."
