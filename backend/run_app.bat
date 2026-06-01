@echo off
REM Build all modules then start the Spring HRMS backend on :8080.

for /d %%D in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do set "JAVA_HOME=%%~fD"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo JDK 21 was not found. Install Temurin JDK 21 or set JAVA_HOME to JDK 21.
  exit /b 1
)

for /d %%D in ("%LOCALAPPDATA%\Programs\Apache\apache-maven-*") do set "MAVEN_HOME=%%~fD"
if defined MAVEN_HOME set "PATH=%MAVEN_HOME%\bin;%PATH%"
where mvn.cmd >nul 2>&1
if errorlevel 1 (
  echo Apache Maven was not found. Install Maven or add mvn.cmd to PATH.
  exit /b 1
)

set "PATH=%JAVA_HOME%\bin;%PATH%"
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

if exist ".env.railway" call :load_env ".env.railway"
if exist ".env.face-local" call :load_env ".env.face-local"
if not defined UNIFIEDTREE_FACE_ENCRYPTION_KEY (
  echo UNIFIEDTREE_FACE_ENCRYPTION_KEY is required by canonical-prod. Add the existing database encryption key to .env.railway or .env.face-local before starting the backend.
  exit /b 1
)

set "SPRING_PROFILES_ACTIVE=canonical,canonical-prod"
set "SERVER_PORT=8080"
set "TZ=Asia/Kolkata"
set "SPRING_BATCH_JDBC_INITIALIZE_SCHEMA=never"
set "HRMS_KAFKA_ENABLED=false"
set "UNIFIEDTREE_FACE_WORKER_URL=http://127.0.0.1:8091"
set "UNIFIEDTREE_FACE_MATCH_THRESHOLD=0.85"
set "UNIFIEDTREE_FACE_MATCH_MEAN_GAP=0.05"
set "UNIFIEDTREE_FACE_MATCH_TEMPLATE_GAP=0.04"
set "UNIFIEDTREE_FACE_MATCH_QUORUM=4"
set "UNIFIEDTREE_FACE_MIN_QUALITY=0.60"
set "UNIFIEDTREE_FACE_REQUIRE_LIVENESS=true"
set "UNIFIEDTREE_FACE_LIVENESS_THRESHOLD=0.35"
set "UNIFIEDTREE_ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081,http://192.168.31.74:8081,http://192.168.31.74:19006"
set "UNIFIEDTREE_CORS_ALLOW_CREDENTIALS=false"

echo [INSTALL] Building all modules... > %PROJECT_ROOT%\startup.log
mvn install -DskipTests >> %PROJECT_ROOT%\startup.log 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [INSTALL FAILED] >> %PROJECT_ROOT%\startup.log
  exit /b 1
)
echo [STARTING] Launching Spring Boot... >> %PROJECT_ROOT%\startup.log
mvn spring-boot:run -pl app/hrms-app -am >> %PROJECT_ROOT%\startup.log 2>&1
exit /b %ERRORLEVEL%

:load_env
for /f "usebackq eol=# tokens=1,* delims==" %%A in (%~1) do (
  if not "%%A"=="" set "%%A=%%B"
)
exit /b 0
