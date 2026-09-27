package com.hrms.api.approvals;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The approval Undo journal, {@code hrms.approval_decisions} (V143.50): one row
 * per approve / reject, written by {@link DecisionJournalAspect} in the same
 * transaction as the decision, and read by Undo and "recent decisions".
 *
 * <p>JDBC only; no JPA entity maps the table. Every statement filters on
 * {@code tenant_id} as well as row-level security. Callers look the table up
 * with {@link #available()} first: while the migration isn't applied, nothing
 * is recorded and Undo answers FEATURE_NOT_READY.
 */
@Component
public class DecisionJournal {

    /** How long the decider can take a decision back (redesign DECISIONS 15). */
    public static final Duration UNDO_WINDOW = Duration.ofMinutes(10);
    /** Most recent decisions returned at once. */
    static final int RECENT_LIMIT = 50;
    static final int NOTE_MAX = 500;
    static final int SUMMARY_MAX = 300;

    private final JdbcTemplate jdbc;

    public DecisionJournal(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** One journal row. */
    public record Entry(UUID id, DecisionKind kind, UUID requestId, UUID employeeId, String decision,
                        String decidedStatus, String decisionPath, UUID decidedByEmployeeId,
                        Instant decidedAt, Instant undoUntil, String priorState, String postState,
                        Long postVersion, String note, String summary, Instant undoneAt) {
    }

    /** What the recorder writes. */
    public record NewEntry(UUID tenantId, DecisionKind kind, UUID requestId, UUID employeeId, String decision,
                           String decidedStatus, String decisionPath, UUID decidedByEmployeeId, UUID decidedByUserId,
                           String priorState, String postState, Long postVersion, String note, String summary) {
    }

    /** A decision the caller can still take back: the web's {@code RecentDecision}. */
    public record Recent(UUID id, String kind, UUID requestId, String decision, UUID employeeId, String employeeName,
                         String summary, String note, Instant decidedAt, Instant undoUntil) {
    }

    /** True once V143.50 is applied. */
    public boolean available() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT to_regclass('hrms.approval_decisions') IS NOT NULL", Boolean.class));
    }

    public void insert(NewEntry e) {
        jdbc.update("""
                INSERT INTO hrms.approval_decisions (id, tenant_id, kind, request_id, employee_id, decision, decided_status,
                    decision_path, decided_by_employee_id, decided_by_user_id, decided_at, undo_until,
                    prior_state, post_state, post_version, note, summary)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now() + make_interval(mins => ?),
                    CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)
                """, e.tenantId(), e.kind().name(), e.requestId(), e.employeeId(), e.decision(), e.decidedStatus(),
                e.decisionPath(), e.decidedByEmployeeId(), e.decidedByUserId(), (int) UNDO_WINDOW.toMinutes(),
                e.priorState(), e.postState(), e.postVersion(), clip(e.note(), NOTE_MAX), clip(e.summary(), SUMMARY_MAX));
    }

    /** The newest decision on this request, locked until the transaction ends (so two Undos can't both win). */
    public Optional<Entry> latestForUpdate(UUID tenantId, DecisionKind kind, UUID requestId) {
        List<Entry> rows = jdbc.query("""
                SELECT id, kind, request_id, employee_id, decision, decided_status, decision_path, decided_by_employee_id,
                       decided_at, undo_until, prior_state::text AS prior_state, post_state::text AS post_state,
                       post_version, note, summary, undone_at
                  FROM hrms.approval_decisions
                 WHERE tenant_id = ? AND kind = ? AND request_id = ?
                 ORDER BY decided_at DESC
                 LIMIT 1
                 FOR UPDATE
                """, ENTRY, tenantId, kind.name(), requestId);
        return rows.stream().findFirst();
    }

    public int markUndone(UUID tenantId, UUID id, UUID byEmployeeId, UUID byUserId) {
        return jdbc.update("""
                UPDATE hrms.approval_decisions
                   SET undone_at = now(), undone_by_employee_id = ?, undone_by_user_id = ?
                 WHERE tenant_id = ? AND id = ? AND undone_at IS NULL
                """, byEmployeeId, byUserId, tenantId, id);
    }

    /** The caller's decisions not taken back yet whose window is still open at {@code now}, newest first. */
    public List<Recent> recent(UUID tenantId, UUID decidedByEmployeeId, Instant now) {
        return jdbc.query("""
                SELECT d.id, d.kind, d.request_id, d.decision, d.employee_id, d.summary, d.note, d.decided_at, d.undo_until,
                       NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS employee_name
                  FROM hrms.approval_decisions d
                  LEFT JOIN hrms.employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id
                 WHERE d.tenant_id = ? AND d.decided_by_employee_id = ? AND d.undone_at IS NULL AND d.undo_until > ?
                   AND NOT EXISTS (SELECT 1 FROM hrms.approval_decisions later
                                    WHERE later.tenant_id = d.tenant_id AND later.kind = d.kind
                                      AND later.request_id = d.request_id AND later.decided_at > d.decided_at)
                 ORDER BY d.decided_at DESC
                 LIMIT ?
                """, (rs, n) -> new Recent(
                        rs.getObject("id", UUID.class), rs.getString("kind"), rs.getObject("request_id", UUID.class),
                        rs.getString("decision"), rs.getObject("employee_id", UUID.class), rs.getString("employee_name"),
                        rs.getString("summary"), rs.getString("note"),
                        rs.getTimestamp("decided_at").toInstant(), rs.getTimestamp("undo_until").toInstant()),
                tenantId, decidedByEmployeeId, Timestamp.from(now), RECENT_LIMIT);
    }

    private static final RowMapper<Entry> ENTRY = (rs, n) -> new Entry(
            rs.getObject("id", UUID.class),
            DecisionKind.valueOf(rs.getString("kind")),
            rs.getObject("request_id", UUID.class),
            rs.getObject("employee_id", UUID.class),
            rs.getString("decision"),
            rs.getString("decided_status"),
            rs.getString("decision_path"),
            rs.getObject("decided_by_employee_id", UUID.class),
            rs.getTimestamp("decided_at").toInstant(),
            rs.getTimestamp("undo_until").toInstant(),
            rs.getString("prior_state"),
            rs.getString("post_state"),
            (Long) rs.getObject("post_version"),
            rs.getString("note"),
            rs.getString("summary"),
            rs.getTimestamp("undone_at") == null ? null : rs.getTimestamp("undone_at").toInstant());

    static String clip(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
