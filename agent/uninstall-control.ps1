# Parent-only uninstall: restore access first, then remove this installation's files.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ScreenTime'
$stateRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ScreenTime\Control'
$serviceExe = Join-Path $installRoot 'Service\ScreenTime.Service.exe'
$receiptPath = Join-Path $stateRoot 'control-install.json'
$recoveryScript = Join-Path $PSScriptRoot 'recover-control.ps1'
if (-not (Test-Path -LiteralPath $recoveryScript)) { throw 'Keep recover-control.ps1 next to this script, or run uninstall from the complete trusted package.' }
& $recoveryScript
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.productId -ne 'ScreenTime.Control.Install.v1') { throw 'No owned installation was found.' }
# These roots were created solely for this receipt. Fail closed if unknown files appeared.
$allowedTopLevel = @('Service','Tray','recover-control.ps1','uninstall-control.ps1')
$unknown = @(Get-ChildItem -LiteralPath $installRoot -Force | Where-Object { $_.Name -notin $allowedTopLevel })
if ($unknown.Count -ne 0) { throw 'Access is restored, but the install folder has unrelated files. Those files and the folder were kept.' }
foreach ($root in @($installRoot, $stateRoot)) {
    foreach ($entry in Get-ChildItem -LiteralPath $root -Force -Recurse) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Access is restored, but an installed path was redirected. Files were kept.' }
    }
}
$configPath = Join-Path $stateRoot 'service.json'
if ((Test-Path -LiteralPath $configPath) -or (Test-Path -LiteralPath (Join-Path $stateRoot 'restriction-group.json'))) {
    & $serviceExe --remove-restriction-group | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Access was restored, but group cleanup could not be verified. Installation files were kept.' }
}
if (Get-Service -Name 'ScreenTime.Control' -ErrorAction SilentlyContinue) {
    & (Join-Path ([Environment]::SystemDirectory) 'sc.exe') delete 'ScreenTime.Control' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Access was restored, but Windows could not remove the service. Files were kept.' }
}
# Stop only this managed tray. Leave other versions/accounts and all reports alone.
$managedTray = Join-Path $installRoot 'Tray\ScreenTime.Agent.exe'
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='ScreenTime.Agent.exe'")) {
    if ($process.ExecutablePath -eq $managedTray) { Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null }
}
# Restore only the Startup link saved from the exact child profile during installation.
$backup = Join-Path $stateRoot 'legacy-startup.lnk'
if (Test-Path -LiteralPath $backup) {
    $profile = Get-CimInstance Win32_UserProfile -Filter "SID='$($receipt.childSid)'"
    if ($profile -and $profile.LocalPath) {
        $startup = Join-Path $profile.LocalPath 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
        $link = Join-Path $startup 'Screen Time Agent.lnk'
        $safeDestination = $true
        $candidate = $startup
        while ($candidate) {
            if ((Test-Path -LiteralPath $candidate) -and ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { $safeDestination = $false; break }
            $parent = Split-Path -Parent $candidate
            if ($parent -eq $candidate) { break }
            $candidate = $parent
        }
        if ($safeDestination -and (Test-Path -LiteralPath $startup) -and -not (Test-Path -LiteralPath $link)) { Copy-Item -LiteralPath $backup -Destination $link }
    }
}
foreach ($process in @(Get-Process -Name 'ScreenTime.Service','ScreenTime.Agent' -ErrorAction SilentlyContinue)) {
    if ($process.Path -in @($serviceExe, $managedTray)) {
        if (-not $process.WaitForExit(20000)) { throw 'Access is restored. A Screen Time program is still closing; rerun uninstall in a moment.' }
    }
}
Remove-Item -LiteralPath $installRoot -Recurse -Force
Remove-Item -LiteralPath $stateRoot -Recurse -Force
$stateParent = Split-Path -Parent $stateRoot
if (@(Get-ChildItem -LiteralPath $stateParent -Force).Count -eq 0) { Remove-Item -LiteralPath $stateParent }
Write-Host 'Screen Time control was removed. The child account and saved telemetry reports were kept.'
Write-Host 'Use the parent dashboard to revoke the old enrollment before enrolling this device again.'
