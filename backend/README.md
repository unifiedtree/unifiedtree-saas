# HRMS Platform

Multi-tenant enterprise HRMS — modular monolith, Spring Boot 3.2 / Java 21.

## Architecture

One deployable. 16 Maven modules with hard package boundaries. Cross-module communication via service interfaces (sync) or Kafka events (async). No cross-module repository access.

```
hrms-platform/
├── hrms-core/         Base entity, tenant filter, exceptions, audit, shared DTOs
├── hrms-auth/         JWT (RS256), Spring Security 6, MFA, refresh token rotation
├── hrms-tenant/       Companies, departments, branches, org chart
├── hrms-employee/     Employee master, lifecycle, face enrollment
├── hrms-attendance/   Face + geo check-in, shifts, Kafka publisher
├── hrms-leave/        Leave types, balances, approval workflow
├── hrms-payroll/      Spring Batch payroll runs, tax engine, payslips
├── hrms-recruitment/  ATS pipeline, candidates, interviews, offers
├── hrms-performance/  OKRs, goals, review cycles, 360 feedback
├── hrms-learning/     Courses, enrollments, certificates
├── hrms-expense/      Claims, policy validation, reimbursement workflow
├── hrms-notification/ WebSocket STOMP, email, Kafka consumers
├── hrms-analytics/    Dashboards, headcount, payroll/leave summaries
├── hrms-ai/           Attrition prediction, resume scoring, HR chatbot
├── hrms-api/          REST controllers — the only HTTP entry point
└── hrms-app/          Spring Boot main, infrastructure config, application.yml
```

## Prerequisites

| Tool | Version |
|------|---------|
| Java | 21 (LTS) |
| Maven | 3.9+ |
| Docker + Docker Compose | 24+ |
| OpenSSL | (for key generation) |

## Quick Start

### 1. Generate RSA keys (once per environment)

```powershell
# Windows
.\scripts\generate-keys.ps1

# Linux / macOS
./scripts/generate-keys.sh
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis zookeeper kafka kafka-ui
```

Kafka UI: http://localhost:9091

### 3. Build and run

```bash
mvn clean package -DskipTests
java -jar hrms-app/target/hrms-app-1.0.0-SNAPSHOT.jar
```

Or with Maven:
```bash
mvn spring-boot:run -pl hrms-app
```

### 4. API docs

- Swagger UI: http://localhost:8080/api/swagger-ui.html
- OpenAPI spec: http://localhost:8080/api/v3/api-docs

## Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_URL` | `jdbc:postgresql://localhost:5432/hrms` | Postgres JDBC URL |
| `DB_USERNAME` | `hrms` | Postgres user |
| `DB_PASSWORD` | `hrms` | Postgres password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PASSWORD` | `hrms` | Redis password |
| `KAFKA_SERVERS` | `localhost:9092` | Kafka bootstrap servers |
| `JWT_PRIVATE_KEY_PATH` | `classpath:keys/private.pem` | RS256 private key |
| `FACE_SIDECAR_URL` | `http://localhost:8085` | Python face-recognition sidecar |
| `AI_SIDECAR_URL` | `http://localhost:8093` | Python AI/ML sidecar |
| `SMTP_HOST` | `localhost` | Email SMTP host |

## Multi-tenancy

Every request resolves the tenant from the JWT claim `tenant_id` → stored in `TenantContext` (ThreadLocal) → Hibernate `@Filter` activated on every `@Transactional` method via `TenantFilterAspect`. Application code cannot query across tenant boundaries.

## Kafka Topics

| Topic | Publisher | Consumers |
|-------|-----------|-----------|
| `attendance.checkin.v1` | hrms-attendance | hrms-notification, hrms-analytics |
| `leave.requested.v1` | hrms-leave | hrms-notification |
| `leave.approved.v1` | hrms-leave | hrms-notification, hrms-payroll |
| `employee.onboarded.v1` | hrms-employee | hrms-auth, hrms-leave, hrms-analytics |
| `employee.offboarded.v1` | hrms-employee | hrms-notification |
| `payroll.run.completed.v1` | hrms-payroll | hrms-notification |
| `expense.submitted.v1` | hrms-expense | hrms-notification, hrms-analytics |

## WebSocket Topics

| Topic | Consumers |
|-------|-----------|
| `/topic/dept/{deptId}/attendance` | Department manager live roster |
| `/topic/company/{companyId}/payroll` | Payroll run progress |
| `/user/queue/notifications` | Personal alerts (per user) |

Connect: `ws://localhost:8080/api/ws` (SockJS fallback available)

## Face Check-in Flow

```
1. App → POST /api/v1/attendance/geo-validate      ← GPS pre-check (PostGIS)
2. App → POST /api/v1/attendance/face-checkin       ← Multipart: frames + metadata
3. Spring Boot → WebClient → Python sidecar         ← FaceNet embedding + liveness
4. Confidence ≥ 0.92 → write AttendanceRecord
5. Kafka publish attendance.checkin.v1
6. notification-service → WebSocket push to /topic/dept/{deptId}/attendance
```

Fallback: 3 failed attempts → PIN. PIN fail → manager override request.

## RBAC Roles

| Role | Scope |
|------|-------|
| `SUPER_ADMIN` | Platform-wide |
| `COMPANY_ADMIN` | Single company |
| `HR_MANAGER` | Cross-department |
| `DEPT_MANAGER` | Own team only |
| `EMPLOYEE` | Self only |

Authorization enforced at three layers: `@PreAuthorize` on controllers, Hibernate tenant filter on DB queries.

## Flyway Migrations

Migrations live in each module's `src/main/resources/db/migration/`. All loaded by `hrms-app` at startup via `classpath*:db/migration`.

| Version | Module | Description |
|---------|--------|-------------|
| V202405120001 | hrms-core | Audit log |
| V202405120002 | hrms-auth | User credentials, refresh tokens |
| V202405120003 | hrms-tenant | Companies, departments, branches |
| V202405120004 | hrms-employee | Employees, documents |
| V202405120005 | hrms-attendance | Attendance records, shifts, geo audits |
| V202405120006 | hrms-leave | Leave types, balances, requests, holidays |
| V202405120007 | hrms-payroll | Payroll runs, payslips, tax slabs |
| V202405120008 | hrms-recruitment | Job postings, candidates, applications, offers |
| V202405120009 | hrms-performance | Review cycles, goals, performance reviews |
| V202405120010 | hrms-learning | Courses, enrollments, certificates |
| V202405120011 | hrms-expense | Claims, items, policies |
| V202405120012 | hrms-notification | Notifications |

## Running Tests

```bash
# All tests (requires Docker for Testcontainers)
mvn test

# Single module
mvn test -pl hrms-auth

# Skip Testcontainers (fast, no Docker)
mvn test -Dspring.profiles.active=unit
```

## Module Boundaries — Enforced Rules

1. Modules never import each other's `repository` packages
2. Cross-module calls go through a public `*Service` interface in the target module
3. Async cross-module events go through Kafka
4. `hrms-api` is the only module that imports all others (for controller wiring)
5. `hrms-app` is the only module with `spring-boot-maven-plugin`
