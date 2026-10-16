# Offline rescue. Run this as the separate parent Administrator, even with no Internet.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell from the parent Administrator account.' }
$serviceName = 'ScreenTime.Control'
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ScreenTime'
$stateRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ScreenTime\Control'
$serviceExe = Join-Path $installRoot 'Service\ScreenTime.Service.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as the parent Administrator and run this rescue script again.'
}
foreach ($path in @($installRoot, $stateRoot)) {
    $item = $path
    while ($item) {
        if ((Test-Path -LiteralPath $item) -and ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a redirected Screen Time path.' }
        $parent = Split-Path -Parent $item
        if ($parent -eq $item) { break }
        $item = $parent
    }
}
$receiptPath = Join-Path $stateRoot 'control-install.json'
if (-not (Test-Path -LiteralPath $receiptPath)) { throw 'No owned Screen Time control installation was found. Nothing was changed.' }
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.productId -ne 'ScreenTime.Control.Install.v1' -or $receipt.childSid -eq $identity.User.Value) {
    throw 'Installation ownership or parent identity check failed. Nothing was changed.'
}
$registered = Get-CimInstance Win32_Service -Filter "Name='ScreenTime.Control'"
if ($registered) {
    if ($registered.PathName.Trim('"') -ne $serviceExe) { throw 'This service name belongs to another executable. Nothing was changed.' }
    # Disable before stopping: automatic recovery cannot re-apply a block during rescue.
    Set-Service -Name $serviceName -StartupType Disabled
    $service = Get-Service -Name $serviceName
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $serviceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
}
if (-not (Test-Path -LiteralPath $serviceExe)) { throw 'The rescue executable is missing. Restore the Service folder from the same trusted package before retrying.' }
$configPath = Join-Path $stateRoot 'service.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    # --prepare never adds child membership; an interrupted first install may have no final config.
    $groupReceiptPath = Join-Path $stateRoot 'restriction-group.json'
    if (Test-Path -LiteralPath $groupReceiptPath) {
        $groupReceipt = Get-Content -LiteralPath $groupReceiptPath -Raw | ConvertFrom-Json
        $group = Get-LocalGroup -Name 'ScreenTimeRestricted' -ErrorAction Stop
        if ($group.SID.Value -ne $groupReceipt.restrictionGroupSid) { throw 'Restriction group identity changed; nothing was removed.' }
        if (@(Get-LocalGroupMember -Group $group).Count -ne 0) { throw 'Unexpected members in a partial installation. Recovery needs the original service.json.' }
    }
    Write-Host 'The unfinished installation is disabled. No child restriction was installed.'
    return
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.windowsSid -ne $receipt.childSid -or $config.parentSid -ne $receipt.parentSid -or $config.windowsSid -eq $identity.User.Value) {
    throw 'The protected installation identity does not match. Nothing was removed.'
}
& $serviceExe --recover | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows could not verify access restoration. Keep the parent signed in and retain the protected installation files.' }
Write-Host 'Rescue finished. The child can sign in again. Screen Time control is stopped and disabled.'
Write-Host 'Saved rules stay on disk. Do not restart the service until you are ready to enforce those rules again.'
