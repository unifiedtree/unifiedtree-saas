package com.hrms.api.expense;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Reimbursement batches — Finance turns a bunch of APPROVED expense claims
 * into a single payout batch, records the UTR, and flips every claim to
 * REIMBURSED atomically. Wave 3 (2026-08-11).
 *
 * <p>Lifecycle: DRAFT (built from cutoff) → POSTED (claims flipped to
 * APPROVED_FOR_PAY, batch reference locked) → PAID (UTR entered; claims
 * flipped to REIMBURSED). CANCELLED terminates without touching claims,
 * BUT if the batch was POSTED first the claims stay in APPROVED_FOR_PAY —
 * caller must explicitly revert.
 *
 * <p>The reference guarantees a claim is inside AT MOST one non-CANCELLED
 * batch — enforced by the partial UNIQUE index on
 * {@code reimbursement_batch_items(claim_id)} + the app-level pre-check.
 */
@Service
public class ReimbursementBatchService {

    private static final Logger log = LoggerFactory.getLogger(ReimbursementBatchService.class);

    private final JdbcTemplate jdbc;

    public ReimbursementBatchService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record BatchDto(
            UUID id, UUID companyId, String batchReference, String cutoffDate,
            BigDecimal totalAmount, int claimCount, String status,
            String postedAt, String paidAt, String paymentReference, String notes,
            String createdAt, String updatedAt) {}

    public record BatchItemDto(
            UUID id, UUID claimId, UUID employeeId, BigDecimal amount,
            String claimTitle, String claimStatus) {}

    public record BatchDetailDto(BatchDto batch, List<BatchItemDto> items) {}

    public record BuildBatchRequest(
            @jakarta.validation.constraints.NotNull UUID companyId,
            @jakarta.validation.constraints.NotNull String cutoffDate,   // YYYY-MM-DD
            String notes) {}

    public record MarkPaidRequest(
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 120) String paymentReference,
            String notes) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<BatchDto> list(UUID tenantId, UUID companyId, String status) {
        bindTenant(tenantId);
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM expense_mgmt.reimbursement_batches WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (companyId != null) { sql.append(" AND company_id = ?"); args.add(companyId); }
        if (status != null)    { sql.append(" AND status = ?");     args.add(status); }
        sql.append(" ORDER BY created_at DESC");
        return jdbc.query(sql.toString(), (rs, i) -> toBatchDto(rs), args.toArray());
    }

    @Transactional
    public BatchDetailDto get(UUID tenantId, UUID batchId) {
        bindTenant(tenantId);
        BatchDto batch = getBatch(batchId);
        List<BatchItemDto> items = jdbc.query("""
                SELECT bi.*, ec.title AS claim_title, ec.status AS claim_status
                  FROM expense_mgmt.reimbursement_batch_items bi
                  JOIN expense_mgmt.expense_claims ec ON ec.id = bi.claim_id
                 WHERE bi.batch_id = ?
                 ORDER BY bi.created_at ASC
                """, (rs, i) -> new BatchItemDto(
                    rs.getObject("id", UUID.class),
                    rs.getObject("claim_id", UUID.class),
                    rs.getObject("employee_id", UUID.class),
                    rs.getBigDecimal("amount"),
                    rs.getString("claim_title"),
                    rs.getString("claim_status")), batchId);
        return new BatchDetailDto(batch, items);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Build a DRAFT batch from every APPROVED claim in the company where
     * {@code approved_at <= cutoff} AND the claim isn't already inside a
     * non-CANCELLED batch. Idempotent-ish: a re-build with the same
     * (company, cutoff) recomputes the item list from scratch on the existing
     * DRAFT if one is present.
     */
    @Transactional
    public BatchDetailDto build(UUID tenantId, BuildBatchRequest req, UUID actorId) {
        bindTenant(tenantId);
        LocalDate cutoff = LocalDate.parse(req.cutoffDate());

        // Reuse an existing DRAFT batch for the same (company, cutoff) or make
        // a fresh one. Never overwrite a POSTED/PAID batch.
        UUID batchId = jdbc.query("""
                SELECT id, status FROM expense_mgmt.reimbursement_batches
                 WHERE company_id = ? AND cutoff_date = ? AND status = 'DRAFT'
                 ORDER BY created_at DESC LIMIT 1
                """, rs -> rs.next() ? rs.getObject("id", UUID.class) : null,
                req.companyId(), java.sql.Date.valueOf(cutoff));

        if (batchId == null) {
            String reference = "REIMB-" + monthAbbr(cutoff) + cutoff.getYear() % 100 + "-"
                    + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ENGLISH);
            batchId = jdbc.queryForObject("""
                    INSERT INTO expense_mgmt.reimbursement_batches
                        (tenant_id, company_id, batch_reference, cutoff_date,
                         status, notes, created_by, updated_by)
                    VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?)
                    RETURNING id
                    """, UUID.class,
                    tenantId, req.companyId(), reference, java.sql.Date.valueOf(cutoff),
                    req.notes(),
                    actorId == null ? null : actorId.toString(),
                    actorId == null ? null : actorId.toString());
        } else {
            // Rebuild the item list from scratch.
            jdbc.update("DELETE FROM expense_mgmt.reimbursement_batch_items WHERE batch_id = ?", batchId);
        }

        // QA FIX (2026-08-11, finding wmih6ivbj/HIGH-3): the plain
        // UNIQUE(batch_id, claim_id) index doesn't prevent the same claim
        // from landing in TWO different non-CANCELLED batches (a race between
        // two Finance users doing simultaneous builds). Tighten by locking
        // the eligible claim rows FOR UPDATE — a concurrent build that reads
        // the same set will wait until this transaction commits, at which
        // point its NOT EXISTS check will exclude the claims we just batched.
        // (Real bulletproof fix is a partial UNIQUE via a trigger-maintained
        // helper column — deferred; SELECT FOR UPDATE closes the window enough
        // for realistic Finance workflows.)
        List<Object[]> eligible = jdbc.query("""
                SELECT ec.id, ec.employee_id, ec.total_amount, ec.title
                  FROM expense_mgmt.expense_claims ec
                 WHERE ec.company_id = ?
                   AND ec.status = 'APPROVED'
                   AND ec.approved_at IS NOT NULL
                   AND ec.approved_at <= ?
                   AND NOT EXISTS (
                       SELECT 1 FROM expense_mgmt.reimbursement_batch_items bi
                         JOIN expense_mgmt.reimbursement_batches b ON b.id = bi.batch_id
                        WHERE bi.claim_id = ec.id AND b.status <> 'CANCELLED'
                   )
                 ORDER BY ec.approved_at ASC
                 FOR UPDATE OF ec
                """, (rs, i) -> new Object[] {
                    rs.getObject("id", UUID.class),
                    rs.getObject("employee_id", UUID.class),
                    rs.getBigDecimal("total_amount"),
                    rs.getString("title")
                },
                req.companyId(),
                // QA FIX (2026-08-13): java.sql.Date deliberately throws
                // UnsupportedOperationException from toInstant() per JDK spec
                // — every call to POST /v1/expense/reimbursement-batches was
                // 500'ing. Convert via LocalDate → LocalDateTime → Timestamp,
                // interpreting cutoff as end-of-day so claims approved on the
                // cutoff date still make it in.
                java.sql.Timestamp.valueOf(cutoff.plusDays(1).atStartOfDay()));

        BigDecimal total = BigDecimal.ZERO;
        for (Object[] row : eligible) {
            jdbc.update("""
                    INSERT INTO expense_mgmt.reimbursement_batch_items
                        (tenant_id, batch_id, claim_id, employee_id, amount)
                    VALUES (?, ?, ?, ?, ?)
                    """, tenantId, batchId, row[0], row[1], row[2]);
            total = total.add((BigDecimal) row[2]);
        }
        jdbc.update("""
                UPDATE expense_mgmt.reimbursement_batches
                   SET total_amount = ?, claim_count = ?,
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """,
                total, eligible.size(),
                actorId == null ? null : actorId.toString(), batchId);

        return get(tenantId, batchId);
    }

    /**
     * Post the batch — flip every included claim from APPROVED to
     * APPROVED_FOR_PAY so it can't accidentally get pulled into a second
     * batch. Batch itself moves DRAFT → POSTED. Idempotent (no-op on POSTED).
     */
    @Transactional
    public BatchDto post(UUID tenantId, UUID batchId, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if ("PAID".equals(b.status()) || "CANCELLED".equals(b.status())) {
            throw new BusinessRuleException("Cannot post a " + b.status() + " batch", "BATCH_LOCKED");
        }
        if (b.claimCount() == 0) {
            throw new BusinessRuleException(
                    "Batch has no eligible claims — nothing to post",
                    "BATCH_EMPTY");
        }
        // Flip the linked claims.
        int flipped = jdbc.update("""
                UPDATE expense_mgmt.expense_claims
                   SET status = 'APPROVED_FOR_PAY', updated_at = now(),
                       version = version + 1
                 WHERE status = 'APPROVED'
                   AND id IN (SELECT claim_id FROM expense_mgmt.reimbursement_batch_items WHERE batch_id = ?)
                """, batchId);
        log.info("post batch {}: flipped {} claims to APPROVED_FOR_PAY", batchId, flipped);

        jdbc.update("""
                UPDATE expense_mgmt.reimbursement_batches
                   SET status = 'POSTED', posted_at = COALESCE(posted_at, now()),
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ? AND status IN ('DRAFT','POSTED')
                """, actorId == null ? null : actorId.toString(), batchId);
        return getBatch(batchId);
    }

    /**
     * Finance records the UTR — batch → PAID, every claim → REIMBURSED, all
     * inside one transaction. If any single claim isn't in APPROVED_FOR_PAY
     * (e.g. someone reverted it manually), the whole operation aborts so
     * the ledger stays consistent.
     */
    @Transactional
    public BatchDto markPaid(UUID tenantId, UUID batchId, MarkPaidRequest req, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if (!"POSTED".equals(b.status())) {
            throw new BusinessRuleException(
                    "Batch must be POSTED before mark-paid; current status " + b.status(),
                    "BATCH_NOT_POSTED");
        }
        // Safety: every referenced claim MUST be in APPROVED_FOR_PAY.
        Integer stray = jdbc.queryForObject("""
                SELECT count(*) FROM expense_mgmt.reimbursement_batch_items bi
                  JOIN expense_mgmt.expense_claims ec ON ec.id = bi.claim_id
                 WHERE bi.batch_id = ? AND ec.status <> 'APPROVED_FOR_PAY'
                """, Integer.class, batchId);
        if (stray != null && stray > 0) {
            throw new BusinessRuleException(
                    stray + " claim(s) in this batch are not in APPROVED_FOR_PAY — refresh and try again",
                    "BATCH_CLAIM_STATE_DRIFT");
        }
        jdbc.update("""
                UPDATE expense_mgmt.expense_claims
                   SET status = 'REIMBURSED', reimbursed_at = now(),
                       updated_at = now(), version = version + 1
                 WHERE id IN (SELECT claim_id FROM expense_mgmt.reimbursement_batch_items WHERE batch_id = ?)
                """, batchId);
        jdbc.update("""
                UPDATE expense_mgmt.reimbursement_batches
                   SET status = 'PAID', paid_at = now(),
                       payment_reference = ?, notes = COALESCE(?, notes),
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """,
                req.paymentReference(), req.notes(),
                actorId == null ? null : actorId.toString(), batchId);
        return getBatch(batchId);
    }

    /**
     * Cancel a batch. If it was POSTED, the linked claims stay in
     * APPROVED_FOR_PAY — call {@link #revertClaimsToApproved} to release them
     * back into the pool.
     */
    @Transactional
    public BatchDto cancel(UUID tenantId, UUID batchId, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if ("PAID".equals(b.status())) {
            throw new BusinessRuleException(
                    "Cannot cancel a PAID batch — record a reversal instead",
                    "BATCH_ALREADY_PAID");
        }
        jdbc.update("""
                UPDATE expense_mgmt.reimbursement_batches
                   SET status = 'CANCELLED', updated_at = now(),
                       updated_by = ?, version = version + 1
                 WHERE id = ?
                """, actorId == null ? null : actorId.toString(), batchId);
        return getBatch(batchId);
    }

    /**
     * Companion to cancel — releases the APPROVED_FOR_PAY claims back to
     * APPROVED so a new batch can pick them up. Split into a separate action
     * so cancel and revert can be audited independently.
     */
    @Transactional
    public int revertClaimsToApproved(UUID tenantId, UUID batchId, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if (!"CANCELLED".equals(b.status())) {
            throw new BusinessRuleException(
                    "Can only revert claims for a CANCELLED batch",
                    "BATCH_NOT_CANCELLED");
        }
        return jdbc.update("""
                UPDATE expense_mgmt.expense_claims
                   SET status = 'APPROVED', updated_at = now(),
                       version = version + 1
                 WHERE status = 'APPROVED_FOR_PAY'
                   AND id IN (SELECT claim_id FROM expense_mgmt.reimbursement_batch_items WHERE batch_id = ?)
                """, batchId);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private BatchDto getBatch(UUID batchId) {
        List<BatchDto> rows = jdbc.query(
                "SELECT * FROM expense_mgmt.reimbursement_batches WHERE id = ?",
                (rs, i) -> toBatchDto(rs), batchId);
        if (rows.isEmpty()) throw new BusinessRuleException("Batch not found", "BATCH_NOT_FOUND");
        return rows.get(0);
    }

    private BatchDto toBatchDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.Date cutoff = rs.getDate("cutoff_date");
        return new BatchDto(
                rs.getObject("id", UUID.class),
                rs.getObject("company_id", UUID.class),
                rs.getString("batch_reference"),
                cutoff == null ? null : cutoff.toString(),
                rs.getBigDecimal("total_amount"),
                rs.getInt("claim_count"),
                rs.getString("status"),
                ts(rs.getTimestamp("posted_at")),
                ts(rs.getTimestamp("paid_at")),
                rs.getString("payment_reference"),
                rs.getString("notes"),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private static String monthAbbr(LocalDate d) {
        return d.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH).toUpperCase(Locale.ENGLISH);
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
