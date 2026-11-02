param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('node', 'npm')]
    [string]$Tool,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ToolArguments
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$requiredVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.node-version') -Raw).Trim()
if ($requiredVersion -notmatch '^22\.\d+\.\d+$') { throw 'Expected a pinned Node 22 version.' }
$runtimeDirectory = Join-Path $projectRoot ('.local\runtime\node-v' + $requiredVersion + '-win-x64')
$nodeExecutable = Join-Path $runtimeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    throw 'Project-local Node runtime is missing. Follow docs/Task02A_NEAR_Integration_Preparation.md.'
}
$actualVersion = & $nodeExecutable --version
if ($actualVersion -ne ('v' + $requiredVersion)) { throw 'Project-local Node version mismatch.' }
# Reuse the existing npm installation; do not upgrade the machine's npm or PATH.
if ($Tool -eq 'npm') {
    $existingNpm = Get-Command npm.cmd -ErrorAction Stop
    $npmEntryPoint = Join-Path (Split-Path -Parent $existingNpm.Source) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmEntryPoint)) { throw 'Cannot locate the existing npm CLI.' }
}
$previousProcessPath = $env:PATH
$toolExitCode = 1
try {
    $env:PATH = $runtimeDirectory + ';' + $previousProcessPath
    if ($Tool -eq 'npm') { & $nodeExecutable $npmEntryPoint @ToolArguments }
    else { & $nodeExecutable @ToolArguments }
    $toolExitCode = $LASTEXITCODE
} finally {
    $env:PATH = $previousProcessPath
}
exit $toolExitCode
