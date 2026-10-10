package com.hrms.api.roster;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Rosters, their working copy and the published schedule (V143.106), read and written with JDBC only:
 * no JPA entity maps these tables. Row-level security keeps every statement to the caller's tenant;
 * the tenant is also named in every statement. Writes run inside the caller's transaction (a
 * tenant-bound connection is not auto-committing). Nothing here decides a rule: the services do.
 */
@Component
public class RosterStore {

    static final String SHIFT = "SHIFT";
    static final String WO = RosterContract.WO;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public RosterStore(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    // ── shapes ────────────────────────────────────────────────────────────────

    /** A roster header with its department and branch names and member count. */
    public record Header(UUID id, UUID companyId, String name, PeriodType periodType, LocalDate startDate, LocalDate endDate,
                         UUID departmentId, String departmentName, UUID branchId, String branchName,
                         RosterStatus status, RosterSource source, boolean hasUnpublishedChanges, int version, int lockVersion,
                         RosterConfig config, String publishedByName, Instant publishedAt, String updatedByName,
                         Instant updatedAt, int memberCount) {}

    /** What a save writes on the header. */
    public record Draft(String name, PeriodType periodType, LocalDate startDate, LocalDate endDate, UUID departmentId,
                        UUID branchId, RosterConfig config) {}

    /** One non-empty day of the working copy. */
    public record Cell(UUID employeeId, LocalDate date, String kind, UUID shiftPolicyId, boolean edited) {
        public String token() {
            return RosterStore.token(kind, shiftPolicyId);
        }
    }

    /** One published schedule day. */
    public record Day(UUID employeeId, LocalDate date, String kind, UUID shiftPolicyId, UUID rosterId, String rosterName,
                      int rosterVersion) {
        public String token() {
            return RosterStore.token(kind, shiftPolicyId);
        }
    }

    /** One change a publish (or a discard) makes to the published schedule. */
    public record DayChange(UUID employeeId, LocalDate date, ChangeKind change, String oldKind, UUID oldShiftPolicyId,
                            String newKind, UUID newShiftPolicyId) {}

    /** One row of the schedule history, with the person's name. */
    public record HistoryRow(UUID id, UUID employeeId, String employeeName, LocalDate date, ChangeKind change,
                             String oldKind, UUID oldShiftPolicyId, String newKind, UUID newShiftPolicyId, String source,
                             int rosterVersion, String changedByName, Instant changedAt, String note) {}

    /** The cell token of a kind and shift: the shift id, {@code "WO"}, or null. */
    static String token(String kind, UUID shiftPolicyId) {
        if (WO.equals(kind)) return WO;
        return SHIFT.equals(kind) && shiftPolicyId != null ? shiftPolicyId.toString() : null;
    }

    // ── headers ───────────────────────────────────────────────────────────────

    private static final String HEADER = """
            SELECT r.id, r.company_id, r.name, r.period_type, r.start_date, r.end_date, r.department_id, d.name AS department_name,
                   r.branch_id, b.name AS branch_name, r.status, r.source, r.has_unpublished_changes, r.version, r.lock_version,
                   r.config::text AS config, r.published_by_name, r.published_at, r.updated_by_name, r.updated_at,
                   (SELECT count(*) FROM attendance.roster_members m WHERE m.roster_id = r.id) AS member_count
              FROM attendance.rosters r
              LEFT JOIN hrms.departments d ON d.id = r.department_id
              LEFT JOIN org.branches b ON b.id = r.branch_id
            """;

    private final RowMapper<Header> headerRow = (rs, n) -> new Header(
            rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class), rs.getString("name"),
            PeriodType.valueOf(rs.getString("period_type")), rs.getObject("start_date", LocalDate.class),
            rs.getObject("end_date", LocalDate.class), rs.getObject("department_id", UUID.class),
            rs.getString("department_name"), rs.getObject("branch_id", UUID.class), rs.getString("branch_name"),
            RosterStatus.valueOf(rs.getString("status")), RosterSource.valueOf(rs.getString("source")),
            rs.getBoolean("has_unpublished_changes"), rs.getInt("version"), rs.getInt("lock_version"),
            readConfig(rs.getString("config")), rs.getString("published_by_name"), instant(rs.getTimestamp("published_at")),
            rs.getString("updated_by_name"), instant(rs.getTimestamp("updated_at")), rs.getInt("member_count"));

    /** The roster, or null; {@code forUpdate} locks its row until the transaction ends. */
    public Header header(UUID tenant, UUID id, boolean forUpdate) {
        if (forUpdate) {
            // Lock the roster row alone (the joined names are read without a lock).
            List<UUID> locked = jdbc.queryForList("SELECT id FROM attendance.rosters WHERE tenant_id = ? AND id = ? FOR UPDATE",
                    UUID.class, tenant, id);
            if (locked.isEmpty()) return null;
        }
        List<Header> rows = jdbc.query(HEADER + " WHERE r.tenant_id = ? AND r.id = ?", headerRow, tenant, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * The company's rosters overlapping {@code from..to}, newest first; {@code departments} null = all,
     * else only rosters of those departments.
     */
    public List<Header> list(UUID tenant, UUID companyId, LocalDate from, LocalDate to, Set<UUID> departments) {
        if (departments != null && departments.isEmpty()) return List.of();
        String sql = HEADER + " WHERE r.tenant_id = ? AND r.company_id = ? AND r.start_date <= ? AND r.end_date >= ?"
                + (departments == null ? "" : " AND r.department_id = ANY(CAST(? AS uuid[]))")
                + " ORDER BY r.start_date DESC, r.created_at DESC, r.id LIMIT 500";
        return departments == null
                ? jdbc.query(sql, headerRow, tenant, companyId, to, from)
                : jdbc.query(sql, headerRow, tenant, companyId, to, from, PlannerScopeService.uuidArray(departments));
    }

    public UUID insert(UUID tenant, UUID companyId, Draft d, RosterSource source, Actor a) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.rosters (id, tenant_id, company_id, department_id, branch_id, name, period_type,
                       start_date, end_date, status, source, template_id, config,
                       created_by_user_id, created_by_name, updated_by_user_id, updated_by_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, CAST(? AS jsonb), ?, ?, ?, ?)
                """, id, tenant, companyId, d.departmentId(), d.branchId(), d.name(), d.periodType().name(),
                d.startDate(), d.endDate(), source.name(), d.config().templateId(), writeConfig(d.config()),
                a.userId(), a.name(), a.userId(), a.name());
        return id;
    }

    /** Writes a save on the header; 0 when {@code lockVersion} no longer matches (someone else saved). */
    public int update(UUID tenant, UUID id, int lockVersion, Draft d, boolean hasUnpublishedChanges, Actor a) {
        return jdbc.update("""
                UPDATE attendance.rosters
                   SET name = ?, period_type = ?, start_date = ?, end_date = ?, department_id = ?, branch_id = ?,
                       template_id = ?, config = CAST(? AS jsonb), has_unpublished_changes = ?,
                       lock_version = lock_version + 1, updated_by_user_id = ?, updated_by_name = ?, updated_at = now()
                 WHERE tenant_id = ? AND id = ? AND lock_version = ?
                """, d.name(), d.periodType().name(), d.startDate(), d.endDate(), d.departmentId(), d.branchId(),
                d.config().templateId(), writeConfig(d.config()), hasUnpublishedChanges, a.userId(), a.name(),
                tenant, id, lockVersion);
    }

    /** After a publish: PUBLISHED, the new version, nothing unpublished, who and when; the lock moves on. */
    public void markPublished(UUID tenant, UUID id, int version, Actor a) {
        jdbc.update("""
                UPDATE attendance.rosters
                   SET status = 'PUBLISHED', version = ?, has_unpublished_changes = FALSE,
                       published_by_user_id = ?, published_by_name = ?, published_at = now(),
                       first_published_at = COALESCE(first_published_at, now()), lock_version = lock_version + 1
                 WHERE tenant_id = ? AND id = ?
                """, version, a.userId(), a.name(), tenant, id);
    }

    /** After "Discard changes": nothing unpublished; the lock moves on. */
    public void markDiscarded(UUID tenant, UUID id, Actor a) {
        jdbc.update("""
                UPDATE attendance.rosters
                   SET has_unpublished_changes = FALSE, lock_version = lock_version + 1,
                       updated_by_user_id = ?, updated_by_name = ?, updated_at = now()
                 WHERE tenant_id = ? AND id = ?
                """, a.userId(), a.name(), tenant, id);
    }

    /** Deletes a never-published draft (members, staffing and cells go with it); false when it was published. */
    public boolean deleteDraft(UUID tenant, UUID id) {
        return jdbc.update("DELETE FROM attendance.rosters WHERE tenant_id = ? AND id = ? AND version = 0", tenant, id) > 0;
    }

    // ── the working copy ──────────────────────────────────────────────────────

    public List<MemberIn> members(UUID tenant, UUID rosterId) {
        return jdbc.query("SELECT employee_id, rotation_offset FROM attendance.roster_members WHERE tenant_id = ? AND roster_id = ? "
                        + "ORDER BY sort_order, employee_id",
                (rs, n) -> new MemberIn(rs.getObject("employee_id", UUID.class), rs.getInt("rotation_offset")), tenant, rosterId);
    }

    public List<StaffingIn> staffing(UUID tenant, UUID rosterId) {
        return jdbc.query("SELECT designation_id, shift_policy_id, required FROM attendance.roster_staffing "
                        + "WHERE tenant_id = ? AND roster_id = ? ORDER BY designation_id, shift_policy_id",
                (rs, n) -> new StaffingIn(rs.getObject("designation_id", UUID.class), rs.getObject("shift_policy_id", UUID.class),
                        rs.getInt("required")), tenant, rosterId);
    }

    public List<Cell> cells(UUID tenant, UUID rosterId) {
        return jdbc.query("SELECT employee_id, work_date, kind, shift_policy_id, edited FROM attendance.roster_cells "
                        + "WHERE tenant_id = ? AND roster_id = ? ORDER BY employee_id, work_date",
                (rs, n) -> new Cell(rs.getObject("employee_id", UUID.class), rs.getObject("work_date", LocalDate.class),
                        rs.getString("kind"), rs.getObject("shift_policy_id", UUID.class), rs.getBoolean("edited")),
                tenant, rosterId);
    }

    /** Replaces members, staffing and cells in one go (batch delete + insert). */
    public void replaceWorkingCopy(UUID tenant, UUID rosterId, List<MemberIn> members, List<StaffingIn> staffing, List<Cell> cells) {
        jdbc.update("DELETE FROM attendance.roster_cells WHERE tenant_id = ? AND roster_id = ?", tenant, rosterId);
        jdbc.update("DELETE FROM attendance.roster_staffing WHERE tenant_id = ? AND roster_id = ?", tenant, rosterId);
        jdbc.update("DELETE FROM attendance.roster_members WHERE tenant_id = ? AND roster_id = ?", tenant, rosterId);
        List<Object[]> m = new ArrayList<>(members.size());
        for (int i = 0; i < members.size(); i++) {
            m.add(new Object[]{tenant, rosterId, members.get(i).employeeId(), i, members.get(i).rotationOffset()});
        }
        batch("INSERT INTO attendance.roster_members (tenant_id, roster_id, employee_id, sort_order, rotation_offset) VALUES (?, ?, ?, ?, ?)", m);
        List<Object[]> s = new ArrayList<>(staffing.size());
        for (StaffingIn x : staffing) s.add(new Object[]{tenant, rosterId, x.designationId(), x.shiftPolicyId(), x.required()});
        batch("INSERT INTO attendance.roster_staffing (tenant_id, roster_id, designation_id, shift_policy_id, required) VALUES (?, ?, ?, ?, ?)", s);
        List<Object[]> c = new ArrayList<>(cells.size());
        for (Cell x : cells) c.add(new Object[]{tenant, rosterId, x.employeeId(), Date.valueOf(x.date()), x.kind(), x.shiftPolicyId(), x.edited()});
        batch("INSERT INTO attendance.roster_cells (tenant_id, roster_id, employee_id, work_date, kind, shift_policy_id, edited) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)", c);
    }

    /** Replaces only the members and the cells (staffing untouched). */
    public void replaceMembersAndCells(UUID tenant, UUID rosterId, List<MemberIn> members, List<Cell> cells) {
        replaceWorkingCopy(tenant, rosterId, members, staffing(tenant, rosterId), cells);
    }

    // ── the published schedule ────────────────────────────────────────────────

    private static final String DAY = """
            SELECT sd.employee_id, sd.work_date, sd.kind, sd.shift_policy_id, sd.roster_id, r.name AS roster_name, sd.roster_version
              FROM attendance.schedule_days sd
              LEFT JOIN attendance.rosters r ON r.id = sd.roster_id
            """;

    private static final RowMapper<Day> DAY_ROW = (rs, n) -> new Day(rs.getObject("employee_id", UUID.class),
            rs.getObject("work_date", LocalDate.class), rs.getString("kind"), rs.getObject("shift_policy_id", UUID.class),
            rs.getObject("roster_id", UUID.class), rs.getString("roster_name"), rs.getInt("roster_version"));

    /** This roster's published days from {@code from} on; {@code forUpdate} locks them. */
    public List<Day> rosterDays(UUID tenant, UUID rosterId, LocalDate from, boolean forUpdate) {
        return jdbc.query(DAY + " WHERE sd.tenant_id = ? AND sd.roster_id = ? AND sd.work_date >= ? ORDER BY sd.employee_id, sd.work_date"
                + (forUpdate ? " FOR UPDATE OF sd" : ""), DAY_ROW, tenant, rosterId, from);
    }

    /** These people's published days in {@code from..to} that belong to OTHER rosters; {@code forUpdate} locks them. */
    public List<Day> otherRosterDays(UUID tenant, Collection<UUID> employees, LocalDate from, LocalDate to, UUID rosterId,
                                     boolean forUpdate) {
        if (employees.isEmpty() || to.isBefore(from)) return List.of();
        return jdbc.query(DAY + " WHERE sd.tenant_id = ? AND sd.employee_id = ANY(CAST(? AS uuid[])) AND sd.work_date BETWEEN ? AND ?"
                        + " AND sd.roster_id <> ? ORDER BY sd.employee_id, sd.work_date" + (forUpdate ? " FOR UPDATE OF sd" : ""),
                DAY_ROW, tenant, PlannerScopeService.uuidArray(employees), from, to, rosterId);
    }

    /** Everyone's published days in {@code from..to} (the schedule endpoints). */
    public List<Day> days(UUID tenant, Collection<UUID> employees, LocalDate from, LocalDate to) {
        if (employees.isEmpty()) return List.of();
        return jdbc.query(DAY + " WHERE sd.tenant_id = ? AND sd.employee_id = ANY(CAST(? AS uuid[])) AND sd.work_date BETWEEN ? AND ?"
                + " ORDER BY sd.employee_id, sd.work_date", DAY_ROW, tenant, PlannerScopeService.uuidArray(employees), from, to);
    }

    /**
     * Writes a publish's changes to the published schedule and one history row each. An ADDED day goes
     * in only when nobody holds that person and date ({@code ON CONFLICT DO NOTHING}); the answer is the
     * ADDED days that could NOT go in (another roster took them first), so the caller can refuse the
     * publish and roll everything back.
     */
    public List<DayChange> applyChanges(UUID tenant, UUID companyId, UUID rosterId, int version, String source,
                                        List<DayChange> changes, Actor a, String note) {
        List<DayChange> added = new ArrayList<>(), changed = new ArrayList<>(), removed = new ArrayList<>();
        for (DayChange c : changes) {
            switch (c.change()) {
                case ADDED -> added.add(c);
                case CHANGED -> changed.add(c);
                case REMOVED -> removed.add(c);
            }
        }
        List<DayChange> refused = new ArrayList<>();
        for (int from = 0; from < added.size(); from += CHUNK) {
            List<DayChange> part = added.subList(from, Math.min(added.size(), from + CHUNK));
            java.util.Set<String> inserted = new java.util.HashSet<>();
            jdbc.query("""
                    INSERT INTO attendance.schedule_days (tenant_id, employee_id, work_date, company_id, kind, shift_policy_id,
                           roster_id, roster_version, source, updated_by_user_id, updated_by_name)
                    SELECT ?, u.e, u.d, ?, u.k, u.s, ?, ?, ?, ?, ?
                      FROM unnest(CAST(? AS uuid[]), CAST(? AS date[]), CAST(? AS varchar[]), CAST(? AS uuid[])) AS u(e, d, k, s)
                    ON CONFLICT (tenant_id, employee_id, work_date) DO NOTHING
                    RETURNING employee_id, work_date
                    """, (RowCallbackHandler) rs -> inserted.add(rs.getObject("employee_id", UUID.class) + "|" + rs.getObject("work_date", LocalDate.class)),
                    tenant, companyId, rosterId, version, source, a.userId(), a.name(),
                    array(part, c -> c.employeeId().toString()), array(part, c -> c.date().toString()),
                    array(part, DayChange::newKind), array(part, c -> c.newShiftPolicyId() == null ? null : c.newShiftPolicyId().toString()));
            for (DayChange c : part) {
                if (!inserted.contains(c.employeeId() + "|" + c.date())) refused.add(c);
            }
        }
        if (!refused.isEmpty()) return refused;
        if (!changed.isEmpty()) {
            List<Object[]> rows = new ArrayList<>(changed.size());
            for (DayChange c : changed) {
                rows.add(new Object[]{c.newKind(), c.newShiftPolicyId(), version, source, a.userId(), a.name(),
                        tenant, c.employeeId(), Date.valueOf(c.date()), rosterId});
            }
            batch("""
                    UPDATE attendance.schedule_days
                       SET kind = ?, shift_policy_id = ?, roster_version = ?, source = ?, source_ref_id = NULL,
                           updated_by_user_id = ?, updated_by_name = ?, updated_at = now()
                     WHERE tenant_id = ? AND employee_id = ? AND work_date = ? AND roster_id = ?
                    """, rows);
        }
        if (!removed.isEmpty()) {
            List<Object[]> rows = new ArrayList<>(removed.size());
            for (DayChange c : removed) rows.add(new Object[]{tenant, c.employeeId(), Date.valueOf(c.date()), rosterId});
            batch("DELETE FROM attendance.schedule_days WHERE tenant_id = ? AND employee_id = ? AND work_date = ? AND roster_id = ?", rows);
        }
        List<Object[]> history = new ArrayList<>(changes.size());
        for (DayChange c : changes) {
            history.add(new Object[]{tenant, c.employeeId(), Date.valueOf(c.date()), rosterId, version, c.change().name(),
                    c.oldKind(), c.newKind(), c.oldShiftPolicyId(), c.newShiftPolicyId(), source, a.userId(), a.name(), note});
        }
        batch("""
                INSERT INTO attendance.schedule_day_history (tenant_id, employee_id, work_date, roster_id, roster_version, change_kind,
                       old_kind, new_kind, old_shift_policy_id, new_shift_policy_id, source, changed_by_user_id, changed_by_name, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, history);
        return refused;
    }

    /** The roster's schedule history, newest first; {@code employeeId} null = everyone. At most 2,000 rows. */
    public List<HistoryRow> history(UUID tenant, UUID rosterId, UUID employeeId) {
        String sql = """
                SELECT h.id, h.employee_id, concat_ws(' ', e.first_name, e.last_name) AS employee_name, h.work_date, h.change_kind,
                       h.old_kind, h.old_shift_policy_id, h.new_kind, h.new_shift_policy_id, h.source, h.roster_version,
                       h.changed_by_name, h.changed_at, h.note
                  FROM attendance.schedule_day_history h
                  LEFT JOIN hrms.employees e ON e.id = h.employee_id
                 WHERE h.tenant_id = ? AND h.roster_id = ?
                """ + (employeeId == null ? "" : " AND h.employee_id = ?")
                + " ORDER BY h.changed_at DESC, h.work_date, h.employee_id LIMIT 2000";
        RowMapper<HistoryRow> row = (rs, n) -> new HistoryRow(rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                rs.getString("employee_name"), rs.getObject("work_date", LocalDate.class), ChangeKind.valueOf(rs.getString("change_kind")),
                rs.getString("old_kind"), rs.getObject("old_shift_policy_id", UUID.class), rs.getString("new_kind"),
                rs.getObject("new_shift_policy_id", UUID.class), rs.getString("source"), rs.getInt("roster_version"),
                rs.getString("changed_by_name"), instant(rs.getTimestamp("changed_at")), rs.getString("note"));
        return employeeId == null ? jdbc.query(sql, row, tenant, rosterId) : jdbc.query(sql, row, tenant, rosterId, employeeId);
    }

    // ── people ────────────────────────────────────────────────────────────────

    /** Person → company, for the people named (people not found are absent). */
    public java.util.Map<UUID, UUID> companies(UUID tenant, Collection<UUID> employees) {
        java.util.Map<UUID, UUID> out = new java.util.HashMap<>();
        if (employees.isEmpty()) return out;
        jdbc.query("SELECT id, company_id FROM hrms.employees WHERE tenant_id = ? AND id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class)),
                tenant, PlannerScopeService.uuidArray(employees));
        return out;
    }

    /** Person → full name, for the people named. */
    public java.util.Map<UUID, String> names(UUID tenant, Collection<UUID> employees) {
        java.util.Map<UUID, String> out = new java.util.HashMap<>();
        if (employees.isEmpty()) return out;
        jdbc.query("SELECT id, concat_ws(' ', first_name, last_name) AS name FROM hrms.employees WHERE tenant_id = ? AND id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getString("name")),
                tenant, PlannerScopeService.uuidArray(employees));
        return out;
    }

    /** Whether the department is the company's. */
    public boolean departmentOf(UUID tenant, UUID companyId, UUID departmentId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM hrms.departments WHERE id = ? AND tenant_id = ? AND company_id = ?)",
                Boolean.class, departmentId, tenant, companyId));
    }

    /** Whether the branch is the company's. */
    public boolean branchOf(UUID tenant, UUID companyId, UUID branchId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM org.branches WHERE id = ? AND tenant_id = ? AND company_id = ?)",
                Boolean.class, branchId, tenant, companyId));
    }

    /** A department's or branch's name, for a default roster name; null when unknown. */
    public String scopeName(UUID tenant, UUID departmentId, UUID branchId) {
        List<String> parts = new ArrayList<>();
        if (departmentId != null) parts.addAll(jdbc.queryForList("SELECT name FROM hrms.departments WHERE id = ? AND tenant_id = ?",
                String.class, departmentId, tenant));
        if (branchId != null) parts.addAll(jdbc.queryForList("SELECT name FROM org.branches WHERE id = ? AND tenant_id = ?",
                String.class, branchId, tenant));
        parts.removeIf(Objects::isNull);
        return parts.isEmpty() ? null : String.join(" · ", parts);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** Rows per INSERT … SELECT FROM unnest(…) statement. */
    private static final int CHUNK = 2000;

    /** A PostgreSQL array literal ({@code {a,NULL,b}}) for {@code CAST(? AS …[])}; values are ids, ISO dates and kinds. */
    static <T> String array(List<T> items, java.util.function.Function<T, String> value) {
        StringBuilder out = new StringBuilder("{");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) out.append(',');
            String v = value.apply(items.get(i));
            out.append(v == null ? "NULL" : v);
        }
        return out.append('}').toString();
    }

    private void batch(String sql, List<Object[]> rows) {
        if (rows.isEmpty()) return;
        jdbc.batchUpdate(sql, rows, 1000, (ps, row) -> {
            for (int i = 0; i < row.length; i++) ps.setObject(i + 1, row[i]);
        });
    }

    /** The wizard's choices with every missing part at its default (a row saved as {@code '{}'} reads as defaults). */
    static RosterConfig normalize(RosterConfig c) {
        if (c == null) return new RosterConfig(null, List.of(), true, WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD, null, List.of(), List.of());
        List<PatternDay> pattern = c.pattern() == null ? List.of() : c.pattern().stream().filter(Objects::nonNull).toList();
        return new RosterConfig(c.templateId(), pattern, c.repeats(),
                c.weeklyOffMode() == null ? WeeklyOffMode.ROTATIONAL : c.weeklyOffMode(),
                c.staggerMode() == null ? StaggerMode.SPREAD : c.staggerMode(), c.continueFromRosterId(),
                c.shiftIds() == null ? List.of() : c.shiftIds().stream().filter(Objects::nonNull).toList(),
                c.designationIds() == null ? List.of() : c.designationIds().stream().filter(Objects::nonNull).toList());
    }

    RosterConfig readConfig(String text) {
        if (text == null || text.isBlank() || "{}".equals(text.trim())) return normalize(null);
        try {
            return normalize(json.readValue(text, RosterConfig.class));
        } catch (JsonProcessingException e) {
            return normalize(null);
        }
    }

    String writeConfig(RosterConfig c) {
        try {
            return json.writeValueAsString(normalize(c));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Roster config could not be written", e);
        }
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
