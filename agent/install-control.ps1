# Run from the extracted control package in Windows PowerShell as the parent Administrator.
# The one-use enrollment token is prompted securely. Never pass it on the command line.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9._-]{1,64}$')][string]$DeviceId,
    [ValidatePattern('^S-1-5-21-(\d+-){3}\d+$')][string]$ChildSid,
    [string]$ChildAccount
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$serviceName = 'ScreenTime.Control'
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ScreenTime'
$stateParent = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ScreenTime'
$stateRoot = Join-Path $stateParent 'Control'
$serviceExe = Join-Path $installRoot 'Service\ScreenTime.Service.exe'
$trayExe = Join-Path $installRoot 'Tray\ScreenTime.Agent.exe'
$configPath = Join-Path $stateRoot 'service.json'
$receiptPath = Join-Path $stateRoot 'control-install.json'
$productId = 'ScreenTime.Control.Install.v1'

function Assert-Parent {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Right-click PowerShell, choose Run as administrator, and sign in as the parent.'
    }
    if ($identity.User.Value -eq $ChildSid -or $identity.User.Value -eq 'S-1-5-18') {
        throw 'Use the separate parent Administrator account, never the child or SYSTEM account.'
    }
    return $identity.User.Value
}
function Assert-NoReparse([string]$Path) {
    $item = $Path
    while ($item) {
        if (Test-Path -LiteralPath $item) {
            if ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing redirected installation path: $item"
            }
        }
        $parent = Split-Path -Parent $item
        if ($parent -eq $item) { break }
        $item = $parent
    }
}
function Set-ProtectedDirectory([string]$Path, [bool]$AllowRead) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    if ($AllowRead) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Write-ProtectedJson([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 40 -Compress
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
    # Replace inherited ACLs; the credentials must not become readable even if the file existed.
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'Allow')))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Invoke-Sc([string[]]$Arguments) {
    & (Join-Path ([Environment]::SystemDirectory) 'sc.exe') @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Windows could not configure the Screen Time service.' }
}
function Stop-OwnedService {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
        $registered = Get-CimInstance Win32_Service -Filter "Name='ScreenTime.Control'"
        if ($registered.PathName.Trim('"') -ne $serviceExe) { throw 'The service name belongs to another program; nothing was stopped.' }
        Set-Service -Name $serviceName -StartupType Disabled
        if ($service.Status -ne 'Stopped') { Stop-Service -Name $serviceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
    }
}

if (-not $ChildSid) {
    if (-not $ChildAccount) {
        Get-LocalUser | Select-Object Name, Enabled | Format-Table | Out-Host
        $ChildAccount = Read-Host 'Type the child Windows account name from this list'
    }
    $ChildSid = (Get-LocalUser -Name $ChildAccount -ErrorAction Stop).SID.Value
}
$parentSid = Assert-Parent
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
$os = Get-CimInstance Win32_OperatingSystem
$edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
if ([int]$os.BuildNumber -lt 22000 -or $edition -notin @('Professional','ProfessionalN')) {
    throw 'This installer supports Windows 11 Pro, 64-bit.'
}
$baseUri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or $baseUri.Scheme -ne 'https' -or
    $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment -or $baseUri.AbsolutePath -ne '/') {
    throw 'ApiBaseUrl must be the HTTPS dashboard origin, for example https://screen-time.example.com (no /api path).'
}
$ApiBaseUrl = $baseUri.GetLeftPart([UriPartial]::Authority)
$child = Get-LocalUser -SID (New-Object Security.Principal.SecurityIdentifier($ChildSid)) -ErrorAction Stop
if (-not $child.Enabled) { throw 'The child account is disabled. Enable it before setup.' }
$administrators = @(Get-LocalGroupMember -SID (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
if ($administrators.SID.Value -contains $ChildSid) { throw 'Make the child a Standard user in Windows Settings first, then sign the child out. Keep the parent as Administrator.' }
$profile = Get-CimInstance Win32_UserProfile -Filter "SID='$ChildSid'"
if (-not $profile -or -not $profile.LocalPath -or -not (Test-Path -LiteralPath $profile.LocalPath)) {
    throw 'Sign in to the child account once, then sign out and return to the parent. Setup needs the exact child profile.'
}
if ($profile.Loaded) { throw 'Sign the child completely out of Windows, then sign in as the parent and run setup again. Switching users leaves the old child token running.' }
$childProfile = [IO.Path]::GetFullPath($profile.LocalPath)
Assert-NoReparse $childProfile
foreach ($path in @($installRoot, $stateRoot)) { Assert-NoReparse $path }
if (Test-Path -LiteralPath $receiptPath) { throw 'Screen Time control is already installed. Use the recovery/uninstall steps before a new enrollment.' }
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $stateParent)) {
    throw 'An existing ScreenTime installation needs recovery first. No existing files were overwritten.'
}
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'A service with this name already exists. Recover/uninstall it first.' }
foreach ($relative in @('Service\ScreenTime.Service.exe','Tray\ScreenTime.Agent.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relative))) { throw 'Extract the complete Screen Time Control package before running this script.' }
}
# No transcript is started: enrollment and device credentials never appear in routine output.
$secureToken = Read-Host 'Paste the one-use setup token from the parent dashboard (typing is hidden)' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$enrollment = $null
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $requestBody = @{ token = $token; deviceId = $DeviceId; windowsSid = $ChildSid; deviceName = [Environment]::MachineName } | ConvertTo-Json -Compress
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        $enrollment = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/api/agent/control/enroll" -ContentType 'application/json' -Body $requestBody -MaximumRedirection 0
    } catch { throw 'Enrollment failed. Check the dashboard address and use a new setup token. No local access rules were applied.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    $token = $null; $requestBody = $null
    $secureToken.Dispose()
}
if ($enrollment.deviceId -ne $DeviceId -or $enrollment.windowsSid -ne $ChildSid -or -not $enrollment.householdId -or
    -not $enrollment.credential -or -not $enrollment.policyPublicKeyPem -or -not $enrollment.envelope) {
    throw 'The enrollment response was incomplete or targeted another account. No access rules were applied.'
}
try {
    $credentialBytes = [Convert]::FromBase64String($enrollment.credential)
    if ($credentialBytes.Length -ne 32) { throw 'length' }
    [Array]::Clear($credentialBytes, 0, $credentialBytes.Length)
    $initialPayload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($enrollment.envelope.payload)) | ConvertFrom-Json
    if ($initialPayload.policy.mode -ne 'monitor') { throw 'mode' }
} catch { throw 'Enrollment must start in monitor mode with a valid device credential. No access rules were applied.' }

$prepared = $false
$stage = 'protecting installation folders'
try {
    Set-ProtectedDirectory $installRoot $true
    Set-ProtectedDirectory $stateParent $false
    Set-ProtectedDirectory $stateRoot $false
    Write-ProtectedJson $receiptPath @{ productId = $productId; parentSid = $parentSid; childSid = $ChildSid; installedAtUtc = [DateTime]::UtcNow.ToString('o') }
    foreach ($directory in @('Service','Tray')) {
        $source = Join-Path $PSScriptRoot $directory
        $destination = Join-Path $installRoot $directory
        New-Item -ItemType Directory -Path $destination | Out-Null
        foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package files must not be redirected links.' }
            $relativePath = $file.FullName.Substring($source.Length).TrimStart([char[]] '\/')
            $targetPath = Join-Path $destination $relativePath
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $targetPath
            if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash) {
                throw 'Installed files failed verification.'
            }
        }
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'recover-control.ps1') -Destination (Join-Path $installRoot 'recover-control.ps1')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-control.ps1') -Destination (Join-Path $installRoot 'uninstall-control.ps1')
    $stage = 'preparing the Windows restriction group'
    $prepareOutput = & $serviceExe --prepare
    if ($LASTEXITCODE -ne 0) { throw 'Windows could not prepare the owned Screen Time restriction group.' }
    $group = $prepareOutput | ConvertFrom-Json
    if (-not $group.restrictionGroupSid) { throw 'Windows returned no restriction group identity.' }
    $stage = 'saving protected enrollment'
    Write-ProtectedJson $configPath ([ordered]@{
        apiBaseUrl = $ApiBaseUrl; deviceId = $DeviceId; householdId = $enrollment.householdId; windowsSid = $ChildSid;
        parentSid = $parentSid; credential = $enrollment.credential; policyPublicKeyPem = $enrollment.policyPublicKeyPem;
        restrictionGroupSid = $group.restrictionGroupSid
    })
    Write-ProtectedJson (Join-Path $stateRoot 'policy.json') $enrollment.envelope
    $prepared = $true
    $stage = 'switching from the old notification icon'
    # Remove only the child's known legacy Startup shortcut, after verifying its exact executable.
    # Keep its appsettings.json so optional legacy reports continue without sharing the control key.
    $legacyExe = Join-Path $childProfile 'AppData\Local\ScreenTimeAgent\ScreenTime.Agent.exe'
    $shortcutPath = Join-Path $childProfile 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Screen Time Agent.lnk'
    Assert-NoReparse $shortcutPath
    if (Test-Path -LiteralPath $shortcutPath) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ([IO.Path]::GetFullPath($shortcut.TargetPath) -eq [IO.Path]::GetFullPath($legacyExe)) {
            Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $stateRoot 'legacy-startup.lnk')
            Remove-Item -LiteralPath $shortcutPath
        } else { throw 'The child Startup shortcut points somewhere unexpected; it was left untouched.' }
    }
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='ScreenTime.Agent.exe'")) {
        if ($process.ExecutablePath -eq $legacyExe) {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
            if ($owner.Sid -eq $ChildSid) { Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null }
        }
    }
    $stage = 'registering the Windows service'
    Invoke-Sc -Arguments @('create', $serviceName, 'binPath=', "`"$serviceExe`"", 'start=', 'auto', 'obj=', 'LocalSystem', 'DisplayName=', 'Screen Time Control')
    Invoke-Sc -Arguments @('description', $serviceName, 'Protected screen-time rules. Parent Administrator recovery is available offline.')
    Invoke-Sc -Arguments @('failure', $serviceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/10000/restart/30000')
    Invoke-Sc -Arguments @('failureflag', $serviceName, '1')
    # Only SYSTEM and administrators may change the service, stop it, or invoke custom controls.
    Invoke-Sc -Arguments @('sdset', $serviceName, 'D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLORC;;;BU)')
    $stage = 'starting the Windows service'
    Start-Service -Name $serviceName
    $service = Get-Service -Name $serviceName
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    Start-Sleep -Seconds 3
    if ((Get-Service -Name $serviceName).Status -ne 'Running') { throw 'The service did not stay running.' }
    Write-Host 'Installed in MONITOR mode. Nothing is blocked yet.'
    Write-Host 'Sign in as the child once. Check the parent dashboard shows this PC online before enabling rules.'
    Write-Host "Offline rescue: run $installRoot\recover-control.ps1 from parent Administrator PowerShell."
} catch {
    try {
        Stop-OwnedService
        if ($prepared) {
            & $serviceExe --recover | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Access rollback could not be verified.' }
        }
    } catch {
        Write-Warning 'Automatic recovery could not be verified. Keep the parent signed in. Run the supplied recover-control.ps1 as Administrator before enabling anything.'
    }
    if ($prepared -and (Test-Path -LiteralPath (Join-Path $stateRoot 'legacy-startup.lnk')) -and -not (Test-Path -LiteralPath $shortcutPath)) {
        try { Assert-NoReparse $shortcutPath; Copy-Item -LiteralPath (Join-Path $stateRoot 'legacy-startup.lnk') -Destination $shortcutPath } catch { }
    }
    # Keep protected receipts/configuration for offline recovery; never remove a group by display name.
    throw "Setup did not finish while $stage. The service was stopped/disabled where possible. Use parent Administrator recovery before trying again."
} finally { $enrollment = $null }
