[CmdletBinding()]
param([switch]$Apply, [switch]$Check)
$ErrorActionPreference = 'Stop'
if ($Apply -and $Check) { throw 'Choose Apply or Check.' }
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is required.' }
$storePath = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'WealthPixels\testnet-credentials'))
$repoPath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
if ($storePath.Equals($repoPath, [StringComparison]::OrdinalIgnoreCase) -or
    $storePath.StartsWith($repoPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Credential storage must be outside the repository.'
}
$ancestor = $storePath
while ($ancestor) {
    if (Test-Path -LiteralPath $ancestor) {
        if (((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse points are not allowed in the credential path.'
        }
    }
    $parentPath = Split-Path -Parent $ancestor
    if ($parentPath -eq $ancestor) { break }
    $ancestor = $parentPath
}
if (-not $Apply -and -not $Check) {
    Write-Output ('PREVIEW only. Protected store: ' + $storePath)
    Write-Output 'Apply creates an empty owner-and-SYSTEM-only directory; no credentials are generated.'
    return
}
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if ($Apply) {
    if (Test-Path -LiteralPath $storePath) {
        if (-not (Get-Item -LiteralPath $storePath -Force).PSIsContainer) { throw 'Store is not a directory.' }
        if (@(Get-ChildItem -LiteralPath $storePath -Force).Count -ne 0) {
            throw 'Refusing to change a nonempty store. Preserve existing keys and use Check.'
        }
    } else {
        [void](New-Item -ItemType Directory -Path $storePath -Force)
    }
    $permissions = [Security.AccessControl.DirectorySecurity]::new()
    $permissions.SetOwner($currentSid)
    $permissions.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($principal in @($currentSid, $systemSid)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $principal, [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance, [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        [void]$permissions.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $storePath -AclObject $permissions
}
if (-not (Test-Path -LiteralPath $storePath -PathType Container)) { throw 'Protected store does not exist.' }
$actual = Get-Acl -LiteralPath $storePath
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value -or $rules.Count -ne 2) {
    throw 'Store owner/ACL does not match the reviewed policy.'
}
$principalIds = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
if ($principalIds.Count -ne 2 -or $currentSid.Value -notin $principalIds -or $systemSid.Value -notin $principalIds) {
    throw 'Store must grant exactly the current user and SYSTEM.'
}
$wantedInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin @($currentSid.Value, $systemSid.Value) -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.InheritanceFlags -ne $wantedInheritance -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or $rule.IsInherited) {
        throw 'Store ACL contains an unexpected permission.'
    }
}
Write-Output ('Verified credential store: ' + $storePath)
Write-Output 'Only the current Windows user and SYSTEM have inheritable FullControl. Same-user processes remain trusted.'
