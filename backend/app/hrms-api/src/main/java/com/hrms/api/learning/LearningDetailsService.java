package com.hrms.api.learning;

import com.hrms.core.exception.BusinessRuleException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Learning facts for the redesigned Learning page (redesign P-GROW, BW-85):
 * the programs summary, the category list, where a program happens
 * ({@code learning_mgmt.program_locations}, V143.61, JDBC only) and the company's
 * certifications list. Every query filters {@code tenant_id} on every table it reads.
 */
@Service
public class LearningDetailsService {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final int MAX_LOCATION = 150;
    /** A certification "expires soon" within this many days. */
    static final int EXPIRING_DAYS = 60;
    private static final int MAX_PAGE_SIZE = 200;

    private final JdbcTemplate jdbc;

    public LearningDetailsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Programs tiles: in the catalogue (not cancelled), running now (ONGOING),
     * enrollments made this calendar year (India dates; dropped ones left out).
     * {@code locations} and {@code certificationNames} say whether V143.61's
     * location table and proposal column exist, so the page shows those fields.
     */
    public record ProgramsSummary(int inCatalogue, int ongoing, int planned, int enrollmentsThisYear,
                                  int year, boolean locations, boolean certificationNames) {}

    public record Certification(UUID skillId, UUID employeeId, String employeeName, String employeeCode,
                                String department, String skillName, String certificationName,
                                LocalDate certifiedOn, LocalDate expiresOn, String status, Integer daysLeft) {}

    public record PageDto<T>(List<T> items, int page, int size, long total) {}

    // ── readiness ─────────────────────────────────────────────────────────────

    boolean locationsReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT to_regclass('learning_mgmt.program_locations') IS NOT NULL", Boolean.class));
    }

    boolean certificationNamesReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'learning_mgmt' AND table_name = 'skill_assessments'
                                  AND column_name = 'certification_name')
                """, Boolean.class));
    }

    // ── summary and categories ────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ProgramsSummary summary(UUID tenantId, UUID companyId) {
        int year = LocalDate.now(IST).getYear();
        List<Object> args = new ArrayList<>(List.of(tenantId));
        String company = "";
        if (companyId != null) { company = " AND p.company_id = ?"; args.add(companyId); }
        Object[] programs = jdbc.query("""
                SELECT COUNT(*) FILTER (WHERE p.status <> 'CANCELLED') AS catalogue,
                       COUNT(*) FILTER (WHERE p.status = 'ONGOING')    AS ongoing,
                       COUNT(*) FILTER (WHERE p.status = 'PLANNED')    AS planned
                  FROM learning_mgmt.training_programs p
                 WHERE p.tenant_id = ?""" + company, rs -> rs.next()
                        ? new Object[] { rs.getInt("catalogue"), rs.getInt("ongoing"), rs.getInt("planned") }
                        : new Object[] { 0, 0, 0 }, args.toArray());
        List<Object> eArgs = new ArrayList<>(List.of(tenantId, year));
        if (companyId != null) eArgs.add(companyId);
        Integer enrolled = jdbc.queryForObject("""
                SELECT COUNT(*) FROM learning_mgmt.training_enrollments e
                  JOIN learning_mgmt.training_programs p ON p.id = e.program_id AND p.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.status <> 'DROPPED'
                   AND EXTRACT(YEAR FROM (e.created_at AT TIME ZONE 'Asia/Kolkata')) = ?""" + company,
                Integer.class, eArgs.toArray());
        return new ProgramsSummary((Integer) programs[0], (Integer) programs[1], (Integer) programs[2],
                enrolled == null ? 0 : enrolled, year, locationsReady(), certificationNamesReady());
    }

    /** The categories programs already use, A to Z (case-insensitive, first spelling kept). */
    @Transactional(readOnly = true)
    public List<String> categories(UUID tenantId) {
        return jdbc.queryForList("""
                SELECT MIN(TRIM(category)) FROM learning_mgmt.training_programs
                 WHERE tenant_id = ? AND category IS NOT NULL AND TRIM(category) <> ''
                 GROUP BY LOWER(TRIM(category))
                 ORDER BY LOWER(TRIM(category))
                """, String.class, tenantId);
    }

    // ── locations ─────────────────────────────────────────────────────────────

    /** program id → location, for the given programs; empty before V143.61. */
    Map<UUID, String> locations(UUID tenantId, Collection<UUID> programIds) {
        if (programIds.isEmpty() || !locationsReady()) return Map.of();
        List<Object> args = new ArrayList<>(List.of(tenantId));
        args.addAll(programIds);
        Map<UUID, String> out = new HashMap<>();
        jdbc.query("SELECT program_id, location FROM learning_mgmt.program_locations WHERE tenant_id = ? AND program_id IN ("
                        + String.join(",", java.util.Collections.nCopies(programIds.size(), "?")) + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("program_id", UUID.class), rs.getString("location")),
                args.toArray());
        return out;
    }

    /**
     * Set (or, with blank, clear) where a program happens. The caller checks
     * {@link #locationsReady()} first; nothing here runs without the table.
     */
    void saveLocation(UUID tenantId, UUID programId, String location, UUID actorUserId) {
        String place = cleanLocation(location);
        if (place == null) {
            jdbc.update("DELETE FROM learning_mgmt.program_locations WHERE tenant_id = ? AND program_id = ?", tenantId, programId);
            return;
        }
        jdbc.update("""
                INSERT INTO learning_mgmt.program_locations (tenant_id, program_id, location, updated_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (tenant_id, program_id) DO UPDATE
                   SET location = EXCLUDED.location, updated_by = EXCLUDED.updated_by, updated_at = now()
                """, tenantId, programId, place, actorUserId);
    }

    static String cleanLocation(String location) {
        if (location == null) return null;
        String t = location.trim().replaceAll("\\s+", " ");
        if (t.isEmpty()) return null;
        if (t.length() > MAX_LOCATION) {
            throw new BusinessRuleException("The location can be at most " + MAX_LOCATION + " characters", "FIELD_TOO_LONG");
        }
        return t;
    }

    // ── certifications ────────────────────────────────────────────────────────

    /**
     * Everyone's certifications on file (active employees), soonest expiry first.
     * {@code status}: all (default), valid (no expiry or more than
     * {@value #EXPIRING_DAYS} days left), expiring (within {@value #EXPIRING_DAYS}
     * days), expired. {@code search} matches the person's name or code, the certification or the skill.
     */
    @Transactional(readOnly = true)
    public PageDto<Certification> certifications(UUID tenantId, String status, String search, int page, int size) {
        if (page < 0) page = 0;
        if (size <= 0) size = 25;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;
        LocalDate today = LocalDate.now(IST);
        StringBuilder where = new StringBuilder("""
                 WHERE s.tenant_id = ? AND s.certified = TRUE AND e.is_active = TRUE""");
        List<Object> args = new ArrayList<>(List.of(tenantId));
        switch (statusFilter(status)) {
            case "EXPIRED" -> { where.append(" AND s.expires_on < ?"); args.add(java.sql.Date.valueOf(today)); }
            case "EXPIRING" -> {
                where.append(" AND s.expires_on >= ? AND s.expires_on <= ?");
                args.add(java.sql.Date.valueOf(today));
                args.add(java.sql.Date.valueOf(today.plusDays(EXPIRING_DAYS)));
            }
            case "VALID" -> { where.append(" AND (s.expires_on IS NULL OR s.expires_on > ?)"); args.add(java.sql.Date.valueOf(today.plusDays(EXPIRING_DAYS))); }
            default -> { }
        }
        if (search != null && !search.isBlank()) {
            where.append(" AND (LOWER(e.first_name || ' ' || COALESCE(e.last_name,'')) LIKE ? OR LOWER(COALESCE(e.employee_code,'')) LIKE ?"
                    + " OR LOWER(COALESCE(s.certification_name, '')) LIKE ? OR LOWER(s.skill_name) LIKE ?)");
            String needle = "%" + search.trim().toLowerCase(Locale.ROOT) + "%";
            args.add(needle); args.add(needle); args.add(needle); args.add(needle);
        }
        String from = """
                  FROM learning_mgmt.employee_skills s
                  JOIN hrms.employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                """;
        Long total = jdbc.queryForObject("SELECT COUNT(*) " + from + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        final LocalDate day = today;
        List<Certification> rows = jdbc.query("""
                SELECT s.id, s.employee_id, s.skill_name, s.certification_name, s.certified_on, s.expires_on,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS employee_name,
                       e.employee_code, d.name AS department
                """ + from + where + """
                 ORDER BY s.expires_on ASC NULLS LAST, LOWER(e.first_name), s.skill_name
                 LIMIT ? OFFSET ?
                """, (rs, i) -> {
                    java.sql.Date on = rs.getDate("certified_on"), exp = rs.getDate("expires_on");
                    LocalDate expires = exp == null ? null : exp.toLocalDate();
                    return new Certification(rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                            rs.getString("employee_name"), rs.getString("employee_code"), rs.getString("department"),
                            rs.getString("skill_name"), rs.getString("certification_name"),
                            on == null ? null : on.toLocalDate(), expires, certificationStatus(expires, day),
                            expires == null ? null : (int) ChronoUnit.DAYS.between(day, expires));
                }, pageArgs.toArray());
        return new PageDto<>(rows, page, size, total == null ? 0 : total);
    }

    /** CERTIFIED, EXPIRING (within {@value #EXPIRING_DAYS} days, today included) or EXPIRED. */
    static String certificationStatus(LocalDate expiresOn, LocalDate today) {
        if (expiresOn == null) return "CERTIFIED";
        if (expiresOn.isBefore(today)) return "EXPIRED";
        if (!expiresOn.isAfter(today.plusDays(EXPIRING_DAYS))) return "EXPIRING";
        return "CERTIFIED";
    }

    static String statusFilter(String status) {
        String s = status == null || status.isBlank() ? "ALL" : status.trim().toUpperCase(Locale.ROOT);
        if (!List.of("ALL", "VALID", "EXPIRING", "EXPIRED").contains(s)) {
            throw new BusinessRuleException("Status must be all, valid, expiring or expired", "INVALID_STATUS");
        }
        return s;
    }
}
