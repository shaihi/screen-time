# Developer packaging only. The produced ZIP needs no .NET installation on the child PC.
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts'))
$ErrorActionPreference = 'Stop'
$dotnet = Get-Command dotnet -ErrorAction Stop
$package = Join-Path $OutputDirectory 'ScreenTime-Control'
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
New-Item -ItemType Directory -Path $package -Force | Out-Null
foreach ($entry in @(
    @{ Project = 'ScreenTime.Service\ScreenTime.Service.csproj'; Output = 'Service' },
    @{ Project = 'ScreenTime.Agent\ScreenTime.Agent.csproj'; Output = 'Tray' }
)) {
    & $dotnet.Source publish (Join-Path $PSScriptRoot $entry.Project) -c Release -r win-x64 --self-contained true -p:EnableWindowsTargeting=true -p:PublishSingleFile=true -o (Join-Path $package $entry.Output)
    if ($LASTEXITCODE -ne 0) { throw "Could not build $($entry.Output)." }
}
foreach ($name in @('install-control.ps1','recover-control.ps1','uninstall-control.ps1','test-control-install.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $package
}
$instructions = Join-Path $PSScriptRoot '..\docs\START-HERE.md'
if (Test-Path -LiteralPath $instructions) { Copy-Item -LiteralPath $instructions -Destination (Join-Path $package 'START-HERE.md') }
$zip = Join-Path $OutputDirectory 'ScreenTime-Control-win-x64.zip'
Compress-Archive -Path $package -DestinationPath $zip -Force
Write-Host "Package: $zip"
