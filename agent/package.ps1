param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$projectPath = Join-Path $root "ScreenTime.Agent\ScreenTime.Agent.csproj"
$publishPath = Join-Path $root "ScreenTime.Agent\publish"
$distPath = Join-Path $root "dist"

if (Test-Path -LiteralPath $publishPath) { Remove-Item -LiteralPath $publishPath -Recurse -Force }
if (Test-Path -LiteralPath $distPath) { Remove-Item -LiteralPath $distPath -Recurse -Force }
New-Item -ItemType Directory -Path $distPath -Force | Out-Null

dotnet publish $projectPath -c Release -r win-x64 --self-contained true -o $publishPath
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

if (-not $Version) {
    $csprojXml = [xml](Get-Content -LiteralPath $projectPath -Raw)
    $Version = $csprojXml.Project.PropertyGroup.Version | Select-Object -First 1
}

$stagePath = Join-Path $distPath "ScreenTimeAgent-$Version"
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $publishPath "ScreenTime.Agent.exe") -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $root "install-release.ps1") -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $root "uninstall.ps1") -Destination $stagePath

$zipPath = Join-Path $distPath "ScreenTimeAgent-$Version.zip"
Compress-Archive -Path "$stagePath\*" -DestinationPath $zipPath -Force

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $distPath "ScreenTimeAgent-$Version.zip.sha256") -Value $hash -Encoding ASCII

Write-Host "Packaged $zipPath"
Write-Host "SHA-256: $hash"
