$ErrorActionPreference = 'Stop'

$recoveryRoot = Join-Path $env:LOCALAPPDATA 'UnifiedTreeRecovery'
$pgData = Join-Path $recoveryRoot 'postgres'
$pidFile = Join-Path $pgData 'postmaster.pid'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
$pgLog = Join-Path $recoveryRoot 'postgres.log'

if (-not (Test-Path -LiteralPath $pgCtl)) {
  throw "pg_ctl not found at $pgCtl"
}

if (Test-Path -LiteralPath $pidFile) {
  $resolvedData = (Resolve-Path -LiteralPath $pgData).Path
  $resolvedPid = (Resolve-Path -LiteralPath $pidFile).Path
  if (-not $resolvedPid.StartsWith($resolvedData, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected pid file: $resolvedPid"
  }
  $postgresPid = Get-Content -LiteralPath $pidFile -TotalCount 1
  $process = $null
  if ($postgresPid -match '^\d+$') {
    $process = Get-Process -Id ([int]$postgresPid) -ErrorAction SilentlyContinue
  }
  if ($process -and $process.ProcessName -like 'postgres*') {
    throw "Postgres appears to be running as PID $postgresPid; not removing pid file."
  }
  Remove-Item -LiteralPath $resolvedPid -Force
}

& $pgCtl start -D $pgData -l $pgLog -o '-p 55432 -h 127.0.0.1'
