package com.hrms.api.learning;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Training programs + enrollments. Wave 6 (2026-08-11).
 *
 * <p>Program lifecycle: {@code PLANNED} → {@code ONGOING} → {@code COMPLETED}
 * or {@code CANCELLED}. Cancelled at any point marks all non-terminal
 * enrollments as {@code DROPPED} — enrollments never hard-delete, so history
 * survives for compliance audit.
 *
 * <p>Enrollment: unique per (program, employee) via app-level pre-check
 * (schema doesn't yet have the UNIQUE — deferred to a later migration).
 * Bulk-enrol supports the "enrol whole department" flow — filters out
 * already-enrolled employees + respects program capacity.
 */
// Explicit bean name — plain "learningService" collides with the JPA-styled
// com.hrms.learning.service.LearningService that's already in the canonical
// scan. Both classes live and do different things (that one is per-entity
// JPA, this one is raw-JDBC CRUD + bulk-enrol); they just can't share the
// default bean name.
@Service("apiLearningService")
public class LearningService {

    private static final Logger log = LoggerFactory.getLogger(LearningService.class);
    private static final int MAX_PAGE_SIZE = 200;
    private static final Set<String> PROGRAM_STATES =
            Set.of("PLANNED", "ONGOING", "COMPLETED", "CANCELLED");
    private static final Set<String> ENROLLMENT_STATES =
            Set.of("ENROLLED", "IN_PROGRESS", "COMPLETED", "DROPPED");

    private final JdbcTemplate jdbc;

    public LearningService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record ProgramDto(
            UUID id, UUID companyId, String title, String description,
            String category, String trainer, String startDate, String endDate,
            Integer capacity, int enrolledCount, String status,
            String createdAt, String updatedAt) {}

    public record CreateProgramRequest(
            @jakarta.validation.constraints.NotNull UUID companyId,
            @jakarta.validation.constraints.NotBlank String title,
            String description, String category, String trainer,
            String startDate, String endDate, Integer capacity) {}

    public record UpdateProgramRequest(
            String title, String description, String category, String trainer,
            String startDate, String endDate, Integer capacity, String status) {}

    public record EnrollmentDto(
            UUID id, UUID programId, UUID employeeId, String employeeName,
            String status, BigDecimal score, String completedAt,
            String createdAt, String updatedAt) {}

    public record EnrollRequest(
            @jakarta.validation.constraints.NotNull UUID employeeId) {}

    public record BulkEnrollRequest(
            @jakarta.validation.constraints.NotNull List<UUID> employeeIds) {}

    public record BulkEnrollResult(int enrolled, int alreadyEnrolled, int rejectedForCapacity) {}

    public record CompleteEnrollmentRequest(BigDecimal score) {}

    public record PageDto<T>(List<T> items, int page, int size, long total) {}

    // ── Programs ─────────────────────────────────────────────────────────────

    @Transactional
    public PageDto<ProgramDto> listPrograms(UUID tenantId, UUID companyId,
                                            String status, String search,
                                            int page, int size) {
        bindTenant(tenantId);
        if (page < 0) page = 0;
        if (size <= 0) size = 25;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;

        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (companyId != null) { where.append(" AND p.company_id = ?"); args.add(companyId); }
        if (status != null)    { where.append(" AND p.status = ?");     args.add(status); }
        if (search != null && !search.isBlank()) {
            where.append(" AND LOWER(p.title) LIKE ?");
            args.add("%" + search.toLowerCase() + "%");
        }

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning_mgmt.training_programs p" + where,
                Long.class, args.toArray());
        if (total == null) total = 0L;

        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add(page * size);

        List<ProgramDto> rows = jdbc.query(
                "SELECT p.*, (SELECT COUNT(*) FROM learning_mgmt.training_enrollments e "
                + "WHERE e.program_id = p.id AND e.status <> 'DROPPED') AS enrolled_count "
                + "FROM learning_mgmt.training_programs p" + where
                + " ORDER BY COALESCE(p.start_date, p.created_at::date) DESC "
                + " LIMIT ? OFFSET ?",
                (rs, i) -> toProgramDto(rs), pageArgs.toArray());
        return new PageDto<>(rows, page, size, total);
    }

    @Transactional
    public ProgramDto getProgram(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        return jdbc.query(
                "SELECT p.*, (SELECT COUNT(*) FROM learning_mgmt.training_enrollments e "
                + "WHERE e.program_id = p.id AND e.status <> 'DROPPED') AS enrolled_count "
                + "FROM learning_mgmt.training_programs p WHERE p.id = ?",
                rs -> {
                    if (!rs.next()) throw new BusinessRuleException("Program not found", "PROGRAM_NOT_FOUND");
                    return toProgramDto(rs);
                }, id);
    }

    @Transactional
    public ProgramDto createProgram(UUID tenantId, CreateProgramRequest req, UUID actorId) {
        bindTenant(tenantId);
        LocalDate start = parseDate(req.startDate());
        LocalDate end   = parseDate(req.endDate());
        if (start != null && end != null && end.isBefore(start)) {
            throw new BusinessRuleException("End date cannot be before start date", "INVALID_DATE_RANGE");
        }
        UUID id = jdbc.queryForObject("""
                INSERT INTO learning_mgmt.training_programs
                    (tenant_id, company_id, title, description, category,
                     trainer, start_date, end_date, capacity, status,
                     created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?)
                RETURNING id
                """, UUID.class,
                tenantId, req.companyId(), req.title(), req.description(), req.category(),
                req.trainer(),
                start == null ? null : java.sql.Date.valueOf(start),
                end   == null ? null : java.sql.Date.valueOf(end),
                req.capacity(),
                actorId == null ? null : actorId.toString(),
                actorId == null ? null : actorId.toString());
        return getProgram(tenantId, id);
    }

    @Transactional
    public ProgramDto updateProgram(UUID tenantId, UUID id, UpdateProgramRequest req, UUID actorId) {
        bindTenant(tenantId);
        ProgramDto existing = getProgram(tenantId, id);

        // Status transition guardrails
        if (req.status() != null) {
            validateProgramStatus(req.status());
            validateStatusTransition(existing.status(), req.status());
        }

        StringBuilder sql = new StringBuilder("UPDATE learning_mgmt.training_programs SET updated_at = now()");
        List<Object> args = new ArrayList<>();
        if (req.title()       != null) { sql.append(", title = ?");       args.add(req.title()); }
        if (req.description() != null) { sql.append(", description = ?"); args.add(req.description()); }
        if (req.category()    != null) { sql.append(", category = ?");    args.add(req.category()); }
        if (req.trainer()     != null) { sql.append(", trainer = ?");     args.add(req.trainer()); }
        if (req.startDate()   != null) { sql.append(", start_date = ?");  args.add(java.sql.Date.valueOf(req.startDate())); }
        if (req.endDate()     != null) { sql.append(", end_date = ?");    args.add(java.sql.Date.valueOf(req.endDate())); }
        if (req.capacity()    != null) { sql.append(", capacity = ?");    args.add(req.capacity()); }
        if (req.status()      != null) { sql.append(", status = ?");      args.add(req.status()); }
        if (actorId != null)           { sql.append(", updated_by = ?");  args.add(actorId.toString()); }
        sql.append(", version = version + 1 WHERE id = ?");
        args.add(id);

        int rows = jdbc.update(sql.toString(), args.toArray());
        if (rows == 0) throw new BusinessRuleException("Program not found", "PROGRAM_NOT_FOUND");

        // CANCELLED cascades — drop all non-terminal enrollments so they no
        // longer show in the reviewer's "in progress" list.
        if ("CANCELLED".equals(req.status())) {
            int dropped = jdbc.update("""
                    UPDATE learning_mgmt.training_enrollments
                       SET status = 'DROPPED', updated_at = now(),
                           updated_by = ?, version = version + 1
                     WHERE program_id = ? AND status NOT IN ('COMPLETED','DROPPED')
                    """, actorId == null ? null : actorId.toString(), id);
            log.info("Program {} cancelled: {} enrollments dropped", id, dropped);
        }
        return getProgram(tenantId, id);
    }

    // ── Enrollments ──────────────────────────────────────────────────────────

    @Transactional
    public List<EnrollmentDto> listEnrollments(UUID tenantId, UUID programId) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT e.*,
                       TRIM(emp.first_name || ' ' || COALESCE(emp.last_name,'')) AS employee_name
                  FROM learning_mgmt.training_enrollments e
                  LEFT JOIN hrms.employees emp ON emp.id = e.employee_id AND emp.tenant_id = e.tenant_id
                 WHERE e.program_id = ?
                 ORDER BY employee_name
                """, (rs, i) -> toEnrollmentDto(rs), programId);
    }

    @Transactional
    public List<EnrollmentDto> myEnrollments(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT e.*,
                       TRIM(emp.first_name || ' ' || COALESCE(emp.last_name,'')) AS employee_name
                  FROM learning_mgmt.training_enrollments e
                  LEFT JOIN hrms.employees emp ON emp.id = e.employee_id AND emp.tenant_id = e.tenant_id
                 WHERE e.employee_id = ?
                 ORDER BY e.created_at DESC
                """, (rs, i) -> toEnrollmentDto(rs), employeeId);
    }

    @Transactional
    public EnrollmentDto enroll(UUID tenantId, UUID programId, EnrollRequest req, UUID actorId) {
        bindTenant(tenantId);
        ProgramDto program = getProgram(tenantId, programId);

        if ("CANCELLED".equals(program.status()) || "COMPLETED".equals(program.status())) {
            throw new BusinessRuleException(
                    "Cannot enrol in a " + program.status() + " program",
                    "PROGRAM_CLOSED");
        }
        // Idempotency — no duplicate ENROLLED/IN_PROGRESS/COMPLETED rows.
        UUID existing = jdbc.query("""
                SELECT id FROM learning_mgmt.training_enrollments
                 WHERE program_id = ? AND employee_id = ? AND status <> 'DROPPED'
                """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                programId, req.employeeId());
        if (existing != null) return getEnrollment(existing);

        // Capacity check (skips if program.capacity is null = unlimited)
        if (program.capacity() != null && program.enrolledCount() >= program.capacity()) {
            throw new BusinessRuleException("Program is at capacity ("
                    + program.capacity() + ")", "PROGRAM_FULL");
        }

        UUID id = jdbc.queryForObject("""
                INSERT INTO learning_mgmt.training_enrollments
                    (tenant_id, program_id, employee_id, status, created_by, updated_by)
                VALUES (?, ?, ?, 'ENROLLED', ?, ?)
                RETURNING id
                """, UUID.class,
                tenantId, programId, req.employeeId(),
                actorId == null ? null : actorId.toString(),
                actorId == null ? null : actorId.toString());
        return getEnrollment(id);
    }

    /**
     * Enrol a batch of employees. Returns counts so the UI can render
     * "Enrolled 8/10, 2 already enrolled, 0 rejected for capacity".
     */
    @Transactional
    public BulkEnrollResult bulkEnroll(UUID tenantId, UUID programId,
                                       BulkEnrollRequest req, UUID actorId) {
        bindTenant(tenantId);
        ProgramDto program = getProgram(tenantId, programId);
        if ("CANCELLED".equals(program.status()) || "COMPLETED".equals(program.status())) {
            throw new BusinessRuleException(
                    "Cannot bulk-enrol in a " + program.status() + " program",
                    "PROGRAM_CLOSED");
        }

        // Snapshot current enrolled count so we can enforce capacity across
        // the batch atomically.
        int enrolledSoFar = program.enrolledCount();
        Integer capacity  = program.capacity();

        int enrolled = 0, dup = 0, cap = 0;
        for (UUID empId : req.employeeIds()) {
            // Explicit ResultSetExtractor<Boolean> — a bare `rs -> rs.next()`
            // lambda is ambiguous with the RowCallbackHandler overload.
            org.springframework.jdbc.core.ResultSetExtractor<Boolean> hasRow = rs -> rs.next();
            Boolean already = jdbc.query("""
                    SELECT 1 FROM learning_mgmt.training_enrollments
                     WHERE program_id = ? AND employee_id = ? AND status <> 'DROPPED'
                    """, hasRow, programId, empId);
            if (Boolean.TRUE.equals(already)) { dup++; continue; }
            if (capacity != null && enrolledSoFar >= capacity) { cap++; continue; }
            jdbc.update("""
                    INSERT INTO learning_mgmt.training_enrollments
                        (tenant_id, program_id, employee_id, status, created_by, updated_by)
                    VALUES (?, ?, ?, 'ENROLLED', ?, ?)
                    """, tenantId, programId, empId,
                    actorId == null ? null : actorId.toString(),
                    actorId == null ? null : actorId.toString());
            enrolled++;
            enrolledSoFar++;
        }
        log.info("Program {} bulk-enrol: {} new / {} already / {} over-capacity",
                programId, enrolled, dup, cap);
        return new BulkEnrollResult(enrolled, dup, cap);
    }

    @Transactional
    public EnrollmentDto drop(UUID tenantId, UUID enrollmentId, UUID actorId) {
        bindTenant(tenantId);
        int rows = jdbc.update("""
                UPDATE learning_mgmt.training_enrollments
                   SET status = 'DROPPED', updated_at = now(),
                       updated_by = ?, version = version + 1
                 WHERE id = ? AND status <> 'DROPPED'
                """, actorId == null ? null : actorId.toString(), enrollmentId);
        if (rows == 0) {
            // Distinguish "already dropped" from "not found"
            org.springframework.jdbc.core.ResultSetExtractor<Boolean> hasRow = rs -> rs.next();
            Boolean exists = jdbc.query(
                    "SELECT 1 FROM learning_mgmt.training_enrollments WHERE id = ?",
                    hasRow, enrollmentId);
            if (!Boolean.TRUE.equals(exists)) {
                throw new BusinessRuleException("Enrollment not found", "ENROLLMENT_NOT_FOUND");
            }
        }
        return getEnrollment(enrollmentId);
    }

    @Transactional
    public EnrollmentDto complete(UUID tenantId, UUID enrollmentId,
                                 CompleteEnrollmentRequest req, UUID actorId) {
        bindTenant(tenantId);
        String status = jdbc.query(
                "SELECT status FROM learning_mgmt.training_enrollments WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, enrollmentId);
        if (status == null) throw new BusinessRuleException("Enrollment not found", "ENROLLMENT_NOT_FOUND");
        if ("DROPPED".equals(status) || "COMPLETED".equals(status)) {
            throw new BusinessRuleException(
                    "Cannot complete enrollment in status " + status,
                    "ENROLLMENT_CLOSED");
        }
        jdbc.update("""
                UPDATE learning_mgmt.training_enrollments
                   SET status = 'COMPLETED', score = ?, completed_at = now(),
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """, req == null ? null : req.score(),
                actorId == null ? null : actorId.toString(), enrollmentId);
        return getEnrollment(enrollmentId);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private EnrollmentDto getEnrollment(UUID id) {
        List<EnrollmentDto> rows = jdbc.query("""
                SELECT e.*,
                       TRIM(emp.first_name || ' ' || COALESCE(emp.last_name,'')) AS employee_name
                  FROM learning_mgmt.training_enrollments e
                  LEFT JOIN hrms.employees emp ON emp.id = e.employee_id AND emp.tenant_id = e.tenant_id
                 WHERE e.id = ?
                """, (rs, i) -> toEnrollmentDto(rs), id);
        if (rows.isEmpty()) throw new BusinessRuleException("Enrollment not found", "ENROLLMENT_NOT_FOUND");
        return rows.get(0);
    }

    private static void validateProgramStatus(String s) {
        if (!PROGRAM_STATES.contains(s))
            throw new BusinessRuleException("Unknown program status: " + s, "INVALID_STATUS");
    }

    private static void validateStatusTransition(String from, String to) {
        // Terminal states are terminal
        if ("COMPLETED".equals(from) || "CANCELLED".equals(from)) {
            throw new BusinessRuleException(
                    "Cannot transition from " + from, "TERMINAL_STATUS");
        }
        // Allowed: PLANNED→ONGOING/CANCELLED, ONGOING→COMPLETED/CANCELLED
        Set<String> allowed = "PLANNED".equals(from)
                ? Set.of("ONGOING", "CANCELLED", "PLANNED")
                : Set.of("COMPLETED", "CANCELLED", "ONGOING");
        if (!allowed.contains(to)) {
            throw new BusinessRuleException(
                    "Invalid transition " + from + " → " + to,
                    "INVALID_TRANSITION");
        }
    }

    private ProgramDto toProgramDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.Date start = rs.getDate("start_date");
        java.sql.Date end   = rs.getDate("end_date");
        int capacityInt     = rs.getInt("capacity");
        Integer capacity    = rs.wasNull() ? null : capacityInt;
        int enrolled        = rs.getInt("enrolled_count");
        return new ProgramDto(
                rs.getObject("id", UUID.class),
                rs.getObject("company_id", UUID.class),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("category"),
                rs.getString("trainer"),
                start == null ? null : start.toString(),
                end   == null ? null : end.toString(),
                capacity, enrolled,
                rs.getString("status"),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private EnrollmentDto toEnrollmentDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new EnrollmentDto(
                rs.getObject("id", UUID.class),
                rs.getObject("program_id", UUID.class),
                rs.getObject("employee_id", UUID.class),
                rs.getString("employee_name"),
                rs.getString("status"),
                rs.getBigDecimal("score"),
                ts(rs.getTimestamp("completed_at")),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private static LocalDate parseDate(String s) {
        if (s == null || s.isBlank()) return null;
        return LocalDate.parse(s);
    }

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
