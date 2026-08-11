param(
    [int]$Port = 18780
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $workspaceRoot 'server'
$distEntry = Join-Path $serverDir 'dist\index.js'

function Get-WorkspaceGatewayProcess {
    param([int]$TargetPort)

    $listener = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $listener) {
        return $null
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" |
        Select-Object -First 1

    if (-not $process) {
        return $null
    }

    $commandLine = $process.CommandLine
    $matchesWorkspaceGateway = $false

    if ($commandLine) {
        $matchesWorkspaceGateway = $commandLine.Contains($distEntry) -or
            $commandLine.Contains('server/dist/index.js') -or
            $commandLine.Contains('server\dist\index.js')
    }

    if ($matchesWorkspaceGateway) {
        return $process
    }

    throw "Port $TargetPort is already in use by a non-workspace process: $($process.Name) [$($process.ProcessId)] $($process.CommandLine)"
}

$existing = Get-WorkspaceGatewayProcess -TargetPort $Port
if ($existing) {
    Write-Host "Stopping existing workspace gateway process $($existing.ProcessId)..."
    Stop-Process -Id $existing.ProcessId -Force
    Start-Sleep -Seconds 2
}

Write-Host 'Building server...'
pushd $workspaceRoot
try {
    pnpm --filter @myopenclaw/server build
    if ($LASTEXITCODE -ne 0) {
        throw 'Server build failed.'
    }
}
finally {
    popd
}

Write-Host 'Starting gateway in background...'
$process = Start-Process -FilePath 'node' -ArgumentList 'server/dist/index.js' -WorkingDirectory $workspaceRoot -WindowStyle Hidden -PassThru

$started = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 750
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($listener -and $listener.OwningProcess -eq $process.Id) {
        $started = $true
        break
    }

    if ($process.HasExited) {
        break
    }
}

if (-not $started) {
    if ($process.HasExited) {
        throw "Gateway exited early with code $($process.ExitCode)."
    }

    throw "Gateway did not start listening on port $Port within the expected time."
}

Write-Host "Gateway is listening on ws://127.0.0.1:$Port/ws (PID: $($process.Id))"
