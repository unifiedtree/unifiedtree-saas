#!/usr/bin/env pwsh
# ============================================================================
# dev-start.ps1 — Start the full UnifiedTree SaasWeb stack locally
#
# What it starts:
#   1. PostgreSQL 16 (Docker)           → localhost:5432
#   2. Spring HRMS backend (canonical)  → http://localhost:8080
#   3. Website (Vite)                   → http://demo.localhost:3000
#   4. Platform (Vite)                  → http://demo.localhost:3001
#
# Prerequisites:
#   - Docker Desktop running
#   - JDK 21 on PATH  (or set $env:JAVA_HOME below)
#   - Maven 3.9+ on PATH  (or set $mavenBin below)
#   - pnpm on PATH  (run: npm i -g pnpm  if missing)
#   - Node 20+ on PATH
#
# Login: http://demo.localhost:3001  →  admin@unifiedtree.demo  /  Hrms@12345
# ============================================================================

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ── Optional: override if JDK / Maven not on PATH ───────────────────────────
# $env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
# $env:PATH = "$env:JAVA_HOME\bin;C:\maven\apache-maven-3.9.6\bin;$env:PATH"

# ── 1. Start Postgres ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[ 1/4 ] Starting PostgreSQL..." -ForegroundColor Cyan
Set-Location $root
docker compose up -d postgres

Write-Host "        Waiting for postgres to be healthy..." -ForegroundColor DarkGray
$tries = 0
do {
    Start-Sleep -Seconds 2
    $health = docker inspect --format "{{.State.Health.Status}}" saas-web-postgres 2>$null
    $tries++
    if ($tries -gt 30) { Write-Error "Postgres did not become healthy in 60s"; exit 1 }
} while ($health -ne "healthy")
Write-Host "        Postgres is healthy." -ForegroundColor Green

# ── 2. Build hrms-api JAR (installs to local Maven repo so hrms-app can use it)
Write-Host ""
Write-Host "[ 2/4 ] Building hrms-api JAR (first run only; cached after that)..." -ForegroundColor Cyan
Set-Location "$root\backend"
mvn install -pl app/hrms-api -am -DskipTests -q
Write-Host "        hrms-api built." -ForegroundColor Green

# ── 3. Start Spring backend in a new window ──────────────────────────────────
Write-Host ""
Write-Host "[ 3/4 ] Starting Spring backend (canonical profile)..." -ForegroundColor Cyan

$backendCmd = @"
cd '$root\backend';
`$env:SPRING_PROFILES_ACTIVE = 'canonical';
`$env:APP_PII_ENCRYPTION_KEY  = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
mvn spring-boot:run -pl app/hrms-app -am;
pause
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal

Write-Host "        Backend starting... watch the new window." -ForegroundColor DarkGray

# ── 4. Install frontend deps (if needed) + start Vite apps ──────────────────
Write-Host ""
Write-Host "[ 4/4 ] Starting frontend apps (website + platform)..." -ForegroundColor Cyan
Set-Location $root

# Website — port 3000
$websiteCmd = @"
cd '$root\apps\website';
pnpm dev;
pause
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $websiteCmd -WindowStyle Normal

# Platform — port 3001
$platformCmd = @"
cd '$root\apps\platform';
pnpm dev;
pause
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $platformCmd -WindowStyle Normal

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Stack starting — wait ~30 s for Spring to finish booting" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend health:  http://localhost:8080/actuator/health"  -ForegroundColor White
Write-Host "  Website:         http://demo.localhost:3000"             -ForegroundColor White
Write-Host "  Platform:        http://demo.localhost:3001"             -ForegroundColor White
Write-Host ""
Write-Host "  Login:  admin@unifiedtree.demo  /  Hrms@12345"          -ForegroundColor Yellow
Write-Host "  Tenant slug 'demo' is seeded by Flyway V900 migration."  -ForegroundColor DarkGray
Write-Host ""
Write-Host "  To stop:  docker compose down  (from $root)"             -ForegroundColor DarkGray
Write-Host ""
