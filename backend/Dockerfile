# syntax=docker/dockerfile:1.6
#
# UnifiedTree backend -- Railway / Docker production image.
#
# Build context: the `backend/` directory.
# In Railway service config:
#   Root Directory   = backend
#   Builder          = Dockerfile (auto-detected when this file is present)
#   Watch Paths      = backend/**
#
# Local build smoke test:
#   docker build -t unifiedtree-backend backend/
#   docker run --rm -p 8080:8080 \
#     -e DB_URL=... -e DB_USERNAME=ut_app -e DB_PASSWORD=... \
#     -e UNIFIEDTREE_JWT_SECRET=... -e UNIFIEDTREE_ALLOWED_ORIGINS=... \
#     unifiedtree-backend

# ---------- Stage 1: build the fat jar ----------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /workspace

# Copy source. .dockerignore excludes target/, .env*, IDE files, etc.
COPY . .

# Build only the bootable app module + its dependencies. Skip tests in image
# build; CI runs them separately.
RUN mvn -B -ntp -DskipTests -pl app/hrms-app -am clean package

# ---------- Stage 2: minimal JRE runtime --------------------------------------
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

# Add a non-root user for safety.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin unifiedtree

COPY --from=builder --chown=unifiedtree:unifiedtree \
     /workspace/app/hrms-app/target/hrms-app-*.jar /app/hrms-app.jar

# Production defaults. All overridable from Railway env config.
ENV JAVA_TOOL_OPTIONS="-Duser.timezone=UTC" \
    SPRING_PROFILES_ACTIVE="canonical,canonical-prod" \
    SPRING_FLYWAY_ENABLED="false" \
    SPRING_BATCH_JDBC_INITIALIZE_SCHEMA="never" \
    HRMS_KAFKA_ENABLED="false" \
    DB_POOL_SIZE="10"

USER unifiedtree
EXPOSE 8080

# Railway injects $PORT. Bind there if present, otherwise 8080.
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar /app/hrms-app.jar --server.port=${PORT:-8080}"]
