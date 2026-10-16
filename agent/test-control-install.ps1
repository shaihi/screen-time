# Read-only installation checks. Does not enable managed mode, change policy, or sign anyone out.
[CmdletBinding()]
param([switch]$RequireRunning)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell from the parent Administrator account.' }
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ScreenTime'
$stateRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ScreenTime\Control'
$serviceExe = Join-Path $installRoot 'Service\ScreenTime.Service.exe'
$configPath = Join-Path $stateRoot 'service.json'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this check in parent Administrator PowerShell.' }
function Assert-Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "CHECK FAILED: $Message" }
    Write-Host "OK: $Message"
}
Assert-Check (Test-Path -LiteralPath $configPath) 'Protected service configuration exists'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath (Join-Path $stateRoot 'control-install.json') -Raw | ConvertFrom-Json
Assert-Check ($receipt.productId -eq 'ScreenTime.Control.Install.v1') 'Installation ownership receipt is valid'
Assert-Check ($config.windowsSid -ne $config.parentSid -and $config.windowsSid -eq $receipt.childSid -and $config.parentSid -eq $receipt.parentSid) 'Parent and child identities are separate and match installation'
$child = Get-LocalUser -SID (New-Object Security.Principal.SecurityIdentifier($config.windowsSid))
Assert-Check ([bool]$child.Enabled) 'The child Windows account is enabled'
$adminMembers = @(Get-LocalGroupMember -SID (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
Assert-Check ($adminMembers.SID.Value -notcontains $config.windowsSid) 'The child is a Standard user'
$group = Get-LocalGroup -Name 'ScreenTimeRestricted'
Assert-Check ($group.SID.Value -eq $config.restrictionGroupSid) 'The owned restriction group SID matches'
$members = @(Get-LocalGroupMember -Group $group)
$memberSids = @($members | ForEach-Object { $_.SID.Value })
Assert-Check ($memberSids -notcontains $config.parentSid) 'The parent is never a member of the restriction group'
Assert-Check (@($members | Where-Object { $_.SID.Value -ne $config.windowsSid }).Count -eq 0) 'The restriction group contains no unrelated accounts'
foreach ($path in @($stateRoot, $configPath, (Join-Path $stateRoot 'policy.json'))) {
    $acl = Get-Acl -LiteralPath $path
    if ($path -eq $stateRoot) { Assert-Check $acl.AreAccessRulesProtected 'Control state uses a protected ACL' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow') {
            Assert-Check ($rule.IdentityReference.Value -in @('S-1-5-18','S-1-5-32-544')) 'Control state is readable only by SYSTEM and Administrators'
        }
    }
}
foreach ($path in @($installRoot, (Join-Path $installRoot 'Service'), (Join-Path $installRoot 'Tray'), $serviceExe, (Join-Path $installRoot 'Tray\ScreenTime.Agent.exe'))) {
    Assert-Check (Test-Path -LiteralPath $path) 'Installed program exists'
    $acl = Get-Acl -LiteralPath $path
    $writeMask = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) {
            Assert-Check (($rule.FileSystemRights -band $writeMask) -eq 0) 'A Standard user cannot modify installed program files'
        }
    }
}
$service = Get-CimInstance Win32_Service -Filter "Name='ScreenTime.Control'"
Assert-Check ([bool]$service) 'Windows service is registered'
Assert-Check ($service.PathName.Trim('"') -eq $serviceExe -and $service.StartName -eq 'LocalSystem') 'Windows service uses the protected executable and SYSTEM account'
if ($RequireRunning) {
    Assert-Check ($service.State -eq 'Running' -and $service.StartMode -eq 'Auto') 'Windows service is running and starts automatically'
}
Write-Host 'Read-only checks passed. Test the real cutoff, restart, offline behavior, parent sign-in, and offline rescue before relying on managed mode.'
