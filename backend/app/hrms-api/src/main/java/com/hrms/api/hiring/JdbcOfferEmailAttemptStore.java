package com.hrms.api.hiring;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** JDBC implementation over hiring_mgmt.offer_email_attempts; tenant RLS applies through the tenant-aware data source. */
@Repository
public class JdbcOfferEmailAttemptStore implements OfferEmailAttemptStore {

    private static final String COLUMNS = """
            id, offer_id, recipient, status, failure_reason, requested_by,
            created_at, completed_at, resolved_by, resolution_note""";

    private static final RowMapper<Attempt> ROW = (rs, n) -> new Attempt(
            rs.getObject("id", UUID.class), rs.getObject("offer_id", UUID.class),
            rs.getString("recipient"), rs.getString("status"), rs.getString("failure_reason"),
            rs.getString("requested_by"), instant(rs.getTimestamp("created_at")),
            instant(rs.getTimestamp("completed_at")), rs.getString("resolved_by"), rs.getString("resolution_note"));

    private final JdbcTemplate jdbc;

    public JdbcOfferEmailAttemptStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Attempt> openAttempt(UUID offerId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM hiring_mgmt.offer_email_attempts"
                        + " WHERE offer_id = ? AND status IN ('PENDING','UNCERTAIN') ORDER BY created_at DESC LIMIT 1",
                ROW, offerId).stream().findFirst();
    }

    @Override
    public UUID start(UUID offerId, String recipient, String requestedBy) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO hiring_mgmt.offer_email_attempts (id, tenant_id, offer_id, recipient, status, requested_by)"
                        + " VALUES (?, ?, ?, ?, 'PENDING', ?)",
                id, TenantContext.requireTenantId(), offerId, recipient, requestedBy);
        return id;
    }

    @Override
    public void complete(UUID attemptId, String status, String failureReason) {
        jdbc.update("UPDATE hiring_mgmt.offer_email_attempts SET status = ?, failure_reason = ?, completed_at = now() WHERE id = ?",
                status, truncate(failureReason), attemptId);
    }

    @Override
    public void resolve(UUID attemptId, String status, String resolvedBy, String note) {
        jdbc.update("UPDATE hiring_mgmt.offer_email_attempts SET status = ?, resolved_by = ?, resolution_note = ?,"
                        + " completed_at = COALESCE(completed_at, now()) WHERE id = ?",
                status, resolvedBy, truncate(note), attemptId);
    }

    @Override
    public Optional<Attempt> find(UUID attemptId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM hiring_mgmt.offer_email_attempts WHERE id = ?", ROW, attemptId)
                .stream().findFirst();
    }

    @Override
    public List<Attempt> list(UUID offerId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM hiring_mgmt.offer_email_attempts WHERE offer_id = ? ORDER BY created_at DESC",
                ROW, offerId);
    }

    private static java.time.Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String truncate(String s) {
        return s == null ? null : s.length() <= 500 ? s : s.substring(0, 500);
    }
}
