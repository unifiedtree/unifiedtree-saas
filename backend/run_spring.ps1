# Run the UnifiedTree HRMS Spring backend (hrms-app module) on port 8080.
# Prereqs:
#   - JDK 21 installed or available through JAVA_HOME
#   - Maven on PATH or installed below LocalAppData\Programs\Apache
#   - database access configured in .env.railway

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
Set-Location $projectRoot

function Find-Java21Home {
  $candidates = @($env:JAVA_HOME)
  $candidates += Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -ExpandProperty FullName

  foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    $java = Join-Path $candidate 'bin\java.exe'
    $release = Join-Path $candidate 'release'
    if ((Test-Path $java) -and (Test-Path $release) -and
        (Select-String -Path $release -Pattern '^JAVA_VERSION="21(\.|")' -Quiet)) {
      return $candidate
    }
  }

  throw 'JDK 21 was not found. Install Temurin JDK 21 or set JAVA_HOME to a JDK 21 installation.'
}

$env:JAVA_HOME = Find-Java21Home
$mavenCommand = Get-Command mvn.cmd -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $mavenCommand) {
  $mavenCommand = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Apache\apache-maven-*\bin\mvn.cmd') -File -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $mavenCommand) {
  throw 'Apache Maven was not found. Install Maven or add mvn.cmd to PATH.'
}

$env:PATH = "$env:JAVA_HOME\bin;$(Split-Path $mavenCommand);$env:PATH"
$env:MAVEN_OPTS = (($env:MAVEN_OPTS, '-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NUL') -join ' ').Trim()

function Import-DotEnv([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

Import-DotEnv "$projectRoot\.env.railway"
Import-DotEnv "$projectRoot\.env.face-local"

if ([string]::IsNullOrWhiteSpace($env:UNIFIEDTREE_FACE_ENCRYPTION_KEY)) {
  throw 'UNIFIEDTREE_FACE_ENCRYPTION_KEY is required by canonical-prod. Add the existing database encryption key to .env.railway or .env.face-local before starting the backend.'
}

$env:SPRING_PROFILES_ACTIVE = 'canonical,canonical-prod'
$env:SERVER_PORT = '8080'
$env:TZ = 'Asia/Kolkata'
$env:SPRING_BATCH_JDBC_INITIALIZE_SCHEMA = 'never'
$env:HRMS_KAFKA_ENABLED = 'false'
$env:UNIFIEDTREE_FACE_WORKER_URL = 'http://127.0.0.1:8091'
$env:UNIFIEDTREE_FACE_MATCH_THRESHOLD = '0.85'
$env:UNIFIEDTREE_FACE_MATCH_MEAN_GAP = '0.05'
$env:UNIFIEDTREE_FACE_MATCH_TEMPLATE_GAP = '0.04'
$env:UNIFIEDTREE_FACE_MATCH_QUORUM = '4'
$env:UNIFIEDTREE_FACE_MIN_QUALITY = '0.45'
$env:UNIFIEDTREE_FACE_REQUIRE_LIVENESS = 'true'
$env:UNIFIEDTREE_FACE_LIVENESS_THRESHOLD = '0.35'
$env:UNIFIEDTREE_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:3002,http://127.0.0.1:3002,http://localhost:8081,http://127.0.0.1:8081,http://192.168.31.74:8081,http://192.168.31.74:19006'
$env:UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS = 'http://*.localhost:3001,http://*.localhost:3000,http://*.localhost:3002,https://*.unifiedtree.com'
$env:UNIFIEDTREE_CORS_ALLOW_CREDENTIALS = 'false'

function Test-BackendHealth {
  try {
    $healthUrl = "http://127.0.0.1:$($env:SERVER_PORT)/api/actuator/health"
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-BackendHealth) {
  Write-Host "UnifiedTree backend is already running on port $env:SERVER_PORT." -ForegroundColor Yellow
  Write-Host "Health: http://127.0.0.1:$env:SERVER_PORT/api/actuator/health" -ForegroundColor DarkGray
  # return
}

# $otherRunner = Get-CimInstance Win32_Process -Filter "name = 'powershell.exe'" |
#   Where-Object {
#     $_.ProcessId -ne $PID -and
#     $_.CommandLine -like '*run_spring.ps1*'
#   } |
#   Select-Object -First 1
#
# if ($otherRunner) {
#   Write-Host "UnifiedTree backend is already starting/running under run_spring.ps1 (PID $($otherRunner.ProcessId))." -ForegroundColor Yellow
#   Write-Host "Wait for http://127.0.0.1:$env:SERVER_PORT/api/actuator/health to return UP." -ForegroundColor DarkGray
#   return
# }

$logFile = Join-Path $projectRoot 'startup.log'
try {
  $stream = [System.IO.File]::Open($logFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $stream.Close()
} catch {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $logFile = Join-Path $projectRoot "startup-$stamp.log"
  Write-Host "startup.log is in use; writing this run to $logFile" -ForegroundColor Yellow
}

Write-Host "Starting UnifiedTree backend (app/hrms-app) on port 8080..." -ForegroundColor Cyan
& $mavenCommand '--projects' 'app/hrms-app' '--also-make' '-DskipTests' 'clean' 'install' *>&1 |
  Tee-Object -FilePath $logFile

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $mavenCommand '-f' 'app/hrms-app/pom.xml' '-Dspring-boot.run.jvmArguments=-Duser.timezone=Asia/Kolkata' 'spring-boot:run' *>&1 |
  Tee-Object -FilePath $logFile -Append
