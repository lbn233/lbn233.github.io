$ErrorActionPreference = 'Stop'
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$serverFile = Join-Path $PSScriptRoot 'judge-server.py'
if (-not (Test-Path -LiteralPath $serverFile)) {
    Write-Error 'Cannot find judge-server.py.'
    exit 1
}
$linuxFile = (& $wslExe -d Ubuntu --exec wslpath -a $serverFile | Select-Object -First 1)
if (-not $linuxFile) { exit 1 }
$linuxFile = $linuxFile.Trim()
& $wslExe -d Ubuntu --exec /usr/bin/python3 $linuxFile
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
