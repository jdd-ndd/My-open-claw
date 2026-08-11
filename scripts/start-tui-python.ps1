param(
    [string]$Gateway = 'ws://127.0.0.1:18780/ws'
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$tuiDir = Join-Path $workspaceRoot 'clients\tui_python'

pushd $tuiDir
try {
    python -m tui_python --gateway $Gateway
}
finally {
    popd
}
