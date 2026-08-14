package com.hrms.api.payroll;

import com.hrms.core.crypto.FieldEncryptor;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Payroll disbursement — turns a LOCKED payroll run into a bank-uploadable
 * NEFT/RTGS file. Wave 2 (2026-08-11).
 *
 * <p>Lifecycle: DRAFT (built from run) → POSTED (file downloaded, awaiting
 * bank confirmation) → PAID (finance recorded UTR; flips payroll.runs.status
 * to PAID). CANCELLED terminates the batch without touching the run.
 *
 * <p>Every batch line is one employee. Employees missing a valid IFSC-bearing
 * bank account are NOT silently dropped — they get a line with
 * {@code status='SKIPPED_MISSING_DETAILS'} and {@code amount=0} so Finance
 * sees the exclusion and can fix it before shipping the batch.
 */
@Service
public class DisbursementBatchService {

    private static final Logger log = LoggerFactory.getLogger(DisbursementBatchService.class);

    /** Employee bank IFSC — same shape check as BankProfileService. */
    private static final Pattern IFSC = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");

    private final JdbcTemplate jdbc;
    /** Nullable: some test wirings don't provide a FieldEncryptor bean.
     *  generateNeftFile() detects null and refuses to emit a masked-account
     *  file — safer than silently misrouting salaries. */
    private final FieldEncryptor fieldEncryptor;

    /**
     * Primary constructor. Marked @Autowired explicitly because when a class
     * has more than one public constructor Spring does NOT auto-pick one — it
     * falls back to a default (no-arg) constructor, which doesn't exist here.
     * Without this annotation the container refuses to boot ("No default
     * constructor found") — see 2026-08-14 rev 00103 crash log.
     */
    @org.springframework.beans.factory.annotation.Autowired
    public DisbursementBatchService(JdbcTemplate jdbc,
                                    ObjectProvider<FieldEncryptor> fieldEncryptorProvider) {
        this.jdbc = jdbc;
        this.fieldEncryptor = fieldEncryptorProvider == null
                ? null
                : fieldEncryptorProvider.getIfAvailable();
    }

    /** Legacy no-encryptor ctor for tests that construct the service directly.
     *  Kept for test call-sites; Spring never picks this because the primary
     *  ctor above is @Autowired. */
    public DisbursementBatchService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.fieldEncryptor = null;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record BatchDto(
            UUID id, UUID companyId, UUID runId, UUID bankProfileId,
            String batchReference, BigDecimal totalAmount, int beneficiaryCount,
            String status, String fileGeneratedAt, String postedAt,
            String paidAt, String paymentReference, String notes,
            String createdAt, String updatedAt) {}

    public record BatchLineDto(
            UUID id, UUID employeeId, String beneficiaryName,
            String accountNoMasked, String ifsc, BigDecimal amount,
            String status, String failureReason) {}

    public record BatchDetailDto(BatchDto batch, List<BatchLineDto> lines) {}

    public record BuildBatchRequest(
            @jakarta.validation.constraints.NotNull UUID runId,
            @jakarta.validation.constraints.NotNull UUID bankProfileId) {}

    public record MarkPaidRequest(
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 120) String paymentReference,
            String notes) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<BatchDto> list(UUID tenantId, UUID runId, UUID companyId, String status) {
        bindTenant(tenantId);
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM payroll.disbursement_batches WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (runId != null)     { sql.append(" AND run_id = ?");        args.add(runId); }
        if (companyId != null) { sql.append(" AND company_id = ?");    args.add(companyId); }
        if (status != null)    { sql.append(" AND status = ?");        args.add(status); }
        sql.append(" ORDER BY created_at DESC");
        return jdbc.query(sql.toString(), (rs, i) -> toBatchDto(rs), args.toArray());
    }

    @Transactional
    public BatchDetailDto get(UUID tenantId, UUID batchId) {
        bindTenant(tenantId);
        BatchDto batch = getBatch(batchId);
        List<BatchLineDto> lines = jdbc.query("""
                SELECT * FROM payroll.disbursement_batch_lines
                 WHERE batch_id = ?
                 ORDER BY beneficiary_name ASC
                """, (rs, i) -> new BatchLineDto(
                    rs.getObject("id", UUID.class),
                    rs.getObject("employee_id", UUID.class),
                    rs.getString("beneficiary_name"),
                    maskAccount(rs.getString("account_no")),
                    rs.getString("ifsc"),
                    rs.getBigDecimal("amount"),
                    rs.getString("status"),
                    rs.getString("failure_reason")), batchId);
        return new BatchDetailDto(batch, lines);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Build a DRAFT batch from a LOCKED payroll run. Idempotent per
     * (run, bank_profile): a second call with the same pair either returns
     * the existing DRAFT or 409s if the prior batch is POSTED/PAID.
     */
    @Transactional
    public BatchDetailDto buildFromRun(UUID tenantId, BuildBatchRequest req, UUID actorId) {
        bindTenant(tenantId);

        // Validate run + bank profile + they belong to the same tenant/company
        Map<String, Object> run = jdbc.query("""
                SELECT id, company_id, status, total_net, period_month, period_year
                  FROM payroll.runs WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return Map.of(
                        "id", rs.getObject("id", UUID.class),
                        "company_id", rs.getObject("company_id", UUID.class),
                        "status", rs.getString("status"),
                        "total_net", rs.getBigDecimal("total_net"),
                        "period_month", rs.getInt("period_month"),
                        "period_year", rs.getInt("period_year"));
                }, req.runId());
        if (run == null) throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        if (!"LOCKED".equals(run.get("status"))) {
            throw new BusinessRuleException(
                    "Bank batch can only be built from a LOCKED payroll run",
                    "RUN_NOT_LOCKED");
        }

        Map<String, Object> profile = jdbc.query("""
                SELECT id, company_id, bank_format, is_active
                  FROM payroll.bank_profiles WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return Map.of(
                        "id", rs.getObject("id", UUID.class),
                        "company_id", rs.getObject("company_id", UUID.class),
                        "bank_format", rs.getString("bank_format"),
                        "is_active", rs.getBoolean("is_active"));
                }, req.bankProfileId());
        if (profile == null) throw new BusinessRuleException("Bank profile not found", "BANK_PROFILE_NOT_FOUND");
        if (!(Boolean) profile.get("is_active"))
            throw new BusinessRuleException("Bank profile is inactive", "BANK_PROFILE_INACTIVE");
        if (!run.get("company_id").equals(profile.get("company_id"))) {
            throw new BusinessRuleException(
                    "Bank profile is for a different company than the payroll run",
                    "COMPANY_MISMATCH");
        }

        // Reuse an existing DRAFT batch for the same (run, profile) if present.
        // Fail loudly if a POSTED/PAID batch already exists (partial-UNIQUE
        // index would raise too; this gives a friendlier message).
        UUID existingId = jdbc.query("""
                SELECT id, status FROM payroll.disbursement_batches
                 WHERE run_id = ? AND bank_profile_id = ?
                   AND status IN ('DRAFT','POSTED','PAID')
                """, rs -> {
                    if (!rs.next()) return null;
                    String s = rs.getString("status");
                    if (!"DRAFT".equals(s)) throw new BusinessRuleException(
                        "An active batch (" + s + ") already exists for this run+bank profile",
                        "BATCH_ALREADY_EXISTS");
                    return rs.getObject("id", UUID.class);
                }, req.runId(), req.bankProfileId());

        UUID batchId = existingId;
        if (batchId == null) {
            String reference = buildBatchReference(
                    (int) run.get("period_month"), (int) run.get("period_year"));
            batchId = jdbc.queryForObject("""
                    INSERT INTO payroll.disbursement_batches
                        (tenant_id, company_id, run_id, bank_profile_id,
                         batch_reference, status, created_by, updated_by)
                    VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)
                    RETURNING id
                    """, UUID.class,
                    tenantId, run.get("company_id"), req.runId(), req.bankProfileId(),
                    reference,
                    actorId == null ? null : actorId.toString(),
                    actorId == null ? null : actorId.toString());
        } else {
            // Rebuilding — wipe old lines so the recompute is clean.
            jdbc.update("DELETE FROM payroll.disbursement_batch_lines WHERE batch_id = ?", batchId);
        }

        // For each employee with payslip_lines on this run, compute NET and
        // pair with their current bank account (if any). Missing IFSC or
        // bank account → SKIPPED_MISSING_DETAILS line with amount=0.
        List<Map<String, Object>> employees = jdbc.query("""
                SELECT l.employee_id                                                       AS employee_id,
                       coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                     - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0)   AS net_amount,
                       trim(e.first_name || ' ' || COALESCE(e.last_name,''))               AS beneficiary_name,
                       ba.account_number_encrypted                                         AS account_no_enc,
                       ba.account_number_last4                                             AS account_no_last4,
                       ba.ifsc_code                                                        AS ifsc
                  FROM payroll.payslip_lines l
                  JOIN hrms.employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
                  LEFT JOIN hrms.employee_bank_accounts ba
                    ON ba.employee_id = e.id
                   AND ba.tenant_id = e.tenant_id
                   AND ba.is_primary = TRUE
                 WHERE l.run_id = ?
                 GROUP BY l.employee_id, e.first_name, e.last_name,
                          ba.account_number_encrypted, ba.account_number_last4, ba.ifsc_code
                 HAVING coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')),0)
                      - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'),0) > 0
                """, (rs, i) -> {
                    Map<String, Object> m = new java.util.HashMap<>();
                    m.put("employee_id",     rs.getObject("employee_id", UUID.class));
                    m.put("net_amount",      rs.getBigDecimal("net_amount"));
                    m.put("beneficiary",     rs.getString("beneficiary_name"));
                    m.put("account_no_enc",  rs.getString("account_no_enc"));
                    m.put("account_no_last4",rs.getString("account_no_last4"));
                    m.put("ifsc",            rs.getString("ifsc"));
                    return m;
                }, req.runId());

        BigDecimal totalAmount = BigDecimal.ZERO;
        int beneficiaryCount = 0;
        for (Map<String, Object> emp : employees) {
            String ifsc = (String) emp.get("ifsc");
            String acct = (String) emp.get("account_no_enc");
            boolean missingBank = acct == null;
            boolean badIfsc = !missingBank && (ifsc == null || !IFSC.matcher(ifsc).matches());
            String lineStatus = missingBank
                    ? "SKIPPED_MISSING_DETAILS"
                    : (badIfsc ? "SKIPPED_INVALID_IFSC" : "READY");
            BigDecimal lineAmt = "READY".equals(lineStatus)
                    ? (BigDecimal) emp.get("net_amount")
                    : BigDecimal.ZERO;
            String reason = missingBank ? "No primary bank account on file"
                          : badIfsc    ? "Invalid IFSC: " + ifsc
                          : null;

            jdbc.update("""
                    INSERT INTO payroll.disbursement_batch_lines
                        (tenant_id, batch_id, employee_id, beneficiary_name,
                         account_no, ifsc, amount, status, failure_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    tenantId, batchId, emp.get("employee_id"), emp.get("beneficiary"),
                    // Only the encrypted account payload flows to the batch line
                    // (still tenant-scoped by RLS). NEVER the plaintext.
                    acct == null ? "" : acct,
                    ifsc == null ? "" : ifsc,
                    lineAmt, lineStatus, reason);

            if ("READY".equals(lineStatus)) {
                totalAmount = totalAmount.add(lineAmt);
                beneficiaryCount++;
            }
        }

        jdbc.update("""
                UPDATE payroll.disbursement_batches
                   SET total_amount = ?, beneficiary_count = ?,
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """,
                totalAmount, beneficiaryCount,
                actorId == null ? null : actorId.toString(),
                batchId);

        return get(tenantId, batchId);
    }

    /**
     * Post the batch — records file_generated_at + flips DRAFT → POSTED. The
     * caller is expected to download the NEFT file immediately after (see
     * {@link #generateNeftFile}). Idempotent: calling post twice on a POSTED
     * batch is a no-op; on PAID it 409s.
     */
    @Transactional
    public BatchDto post(UUID tenantId, UUID batchId, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if ("PAID".equals(b.status()) || "CANCELLED".equals(b.status())) {
            throw new BusinessRuleException("Cannot post a " + b.status() + " batch", "BATCH_LOCKED");
        }
        if (b.beneficiaryCount() == 0) {
            throw new BusinessRuleException(
                    "Batch has no beneficiaries — check for missing bank details",
                    "BATCH_EMPTY");
        }
        jdbc.update("""
                UPDATE payroll.disbursement_batches
                   SET status = 'POSTED',
                       file_generated_at = COALESCE(file_generated_at, now()),
                       posted_at = COALESCE(posted_at, now()),
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ? AND status IN ('DRAFT','POSTED')
                """, actorId == null ? null : actorId.toString(), batchId);
        return getBatch(batchId);
    }

    /**
     * Mark the batch PAID with the UTR/bank reference. Also flips the
     * underlying payroll.runs row to PAID so the Payroll UI reflects reality.
     */
    @Transactional
    public BatchDto markPaid(UUID tenantId, UUID batchId, MarkPaidRequest req, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        // QA FIX (2026-08-11, finding wmih6ivbj/CRIT-0):
        //   Previous guard permitted DRAFT here — that bypassed post() entirely,
        //   meaning no NEFT file was ever generated but the payroll run still
        //   flipped to PAID. Now: only POSTED can mark-paid. If Finance wants
        //   the shortcut, they must POST first (which downloads the file).
        if (!"POSTED".equals(b.status())) {
            throw new BusinessRuleException(
                    "Batch cannot be marked paid in status " + b.status() +
                    " — POST the batch first (this generates the NEFT file).",
                    "BATCH_NOT_POSTED");
        }
        jdbc.update("""
                UPDATE payroll.disbursement_batches
                   SET status = 'PAID', paid_at = now(),
                       payment_reference = ?, notes = COALESCE(?, notes),
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """,
                req.paymentReference(), req.notes(),
                actorId == null ? null : actorId.toString(), batchId);

        // B2/D9 FIX (2026-08-14):
        //   Previous UPDATE allowed status IN ('LOCKED','PROCESSING') — that
        //   silently flipped a run mid-payroll-computation straight to PAID,
        //   losing the intermediate PROCESSING state and lying to the Payroll
        //   UI (which then hides "still processing" progress from Finance).
        //   PROCESSING means the run's still being computed / posted; PAID
        //   should only follow LOCKED (the settled, sealed state).
        //
        //   Guard the run status BEFORE the update so we can refuse loudly
        //   when the run is still PROCESSING — silently no-op'ing would leave
        //   the batch marked PAID while the run stays PROCESSING forever, a
        //   permanent ledger split that never reconciles.
        String currentRunStatus = jdbc.query(
                "SELECT status FROM payroll.runs WHERE id = ?",
                rs -> rs.next() ? rs.getString("status") : null,
                b.runId());
        if ("PROCESSING".equals(currentRunStatus)) {
            throw new BusinessRuleException(
                    "Underlying payroll run is still PROCESSING — cannot mark the "
                    + "disbursement batch PAID until the run finishes and LOCKS.",
                    "RUN_STILL_PROCESSING");
        }
        int flipped = jdbc.update("""
                UPDATE payroll.runs
                   SET status = 'PAID', paid_at = COALESCE(paid_at, now()),
                       updated_at = now()
                 WHERE id = ? AND status = 'LOCKED'
                """, b.runId());
        if (flipped == 0) {
            // Non-fatal but audit it — the batch is PAID even if the run wasn't
            // in an eligible state to flip (already PAID / CANCELLED / not
            // LOCKED). Log for reconciliation; don't roll back the batch.
            log.warn("Batch {} marked PAID but run {} was not in LOCKED (was {}) — no run status change",
                    batchId, b.runId(), currentRunStatus);
        }

        return getBatch(batchId);
    }

    @Transactional
    public BatchDto cancel(UUID tenantId, UUID batchId, UUID actorId) {
        bindTenant(tenantId);
        BatchDto b = getBatch(batchId);
        if ("PAID".equals(b.status())) {
            throw new BusinessRuleException("Cannot cancel a PAID batch — record a reversal instead",
                    "BATCH_ALREADY_PAID");
        }
        jdbc.update("""
                UPDATE payroll.disbursement_batches
                   SET status = 'CANCELLED', updated_at = now(),
                       updated_by = ?, version = version + 1
                 WHERE id = ?
                """, actorId == null ? null : actorId.toString(), batchId);
        return getBatch(batchId);
    }

    // ── File generation (generic NEFT CSV — Wave 2 ships one format) ─────────

    /**
     * Generate the NEFT/RTGS bulk-upload file. Wave 2 ships {@code GENERIC_CSV}
     * only — a permissive column layout most banks' web-upload UIs accept.
     * Wave 5 adds HDFC fixed-width + others.
     */
    @Transactional
    public byte[] generateNeftFile(UUID tenantId, UUID batchId) {
        bindTenant(tenantId);
        BatchDetailDto detail = get(tenantId, batchId);
        String format = jdbc.queryForObject("""
                SELECT bp.bank_format FROM payroll.bank_profiles bp
                  JOIN payroll.disbursement_batches b ON b.bank_profile_id = bp.id
                 WHERE b.id = ?
                """, String.class, batchId);
        if (!"GENERIC_CSV".equals(format)) {
            throw new BusinessRuleException(
                    "Bank format '" + format + "' not implemented yet — falls back to GENERIC_CSV next release",
                    "FORMAT_NOT_IMPLEMENTED");
        }

        // B2/D3 (2026-08-14) — the batch-line DTOs carry ONLY the redacted
        // account string ("•••• (encrypted)"). Writing that into a bank-upload
        // file would silently misroute every salary in the run to whatever
        // Bank of Nowhere account "0000" happens to resolve to. Re-read the
        // encrypted payload from the batch-line row and decrypt via the
        // FieldEncryptor helper (AES-256-GCM, same key that encrypt-at-rest
        // uses on hrms.employee_bank_accounts).
        //
        // If the encryptor bean isn't wired (test/legacy path), REFUSE to
        // generate the file rather than fall back to the masked value —
        // the failure mode of a silent masked-CSV batch is customer money
        // going to a wrong beneficiary.
        if (fieldEncryptor == null) {
            throw new IllegalStateException(
                    "FieldEncryptor bean not available — cannot generate NEFT file with "
                    + "plaintext account numbers. Refusing to emit a masked file "
                    + "(would misroute salaries). Wire com.hrms.core.crypto.FieldEncryptor "
                    + "or use a bank format that supports opaque tokens.");
        }

        // Pull the encrypted payload + last4 for every READY line in one go
        // (RLS already scoped by bindTenant on the caller path).
        List<Map<String, Object>> raw = jdbc.query("""
                SELECT id, account_no
                  FROM payroll.disbursement_batch_lines
                 WHERE batch_id = ? AND status = 'READY'
                """, (rs, i) -> {
                    Map<String, Object> m = new java.util.HashMap<>();
                    m.put("id",         rs.getObject("id", UUID.class));
                    m.put("account_no", rs.getString("account_no"));
                    return m;
                }, batchId);
        java.util.Map<UUID, String> encByLineId = new java.util.HashMap<>();
        for (Map<String, Object> r : raw) {
            encByLineId.put((UUID) r.get("id"), (String) r.get("account_no"));
        }

        StringBuilder csv = new StringBuilder();
        csv.append("beneficiary_name,account_number,ifsc,amount,reference\n");
        for (BatchLineDto line : detail.lines()) {
            if (!"READY".equals(line.status())) continue;
            String encrypted = encByLineId.get(line.id());
            if (encrypted == null || encrypted.isBlank()) {
                throw new IllegalStateException(
                        "READY batch line " + line.id() + " has no encrypted account payload — "
                        + "refusing to emit the NEFT file rather than write an empty account.");
            }
            String plaintext;
            try {
                plaintext = fieldEncryptor.decrypt(encrypted);
            } catch (RuntimeException e) {
                throw new IllegalStateException(
                        "Failed to decrypt account payload for batch line " + line.id()
                        + " — refusing to emit the NEFT file rather than write ciphertext "
                        + "to the bank upload. Cause: " + e.getMessage(), e);
            }
            csv.append(csvEsc(line.beneficiaryName())).append(',');
            csv.append(csvEsc(plaintext)).append(',');
            csv.append(line.ifsc()).append(',');
            csv.append(line.amount().toPlainString()).append(',');
            csv.append(csvEsc(detail.batch().batchReference())).append('\n');
        }
        return csv.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private BatchDto getBatch(UUID batchId) {
        List<BatchDto> rows = jdbc.query(
                "SELECT * FROM payroll.disbursement_batches WHERE id = ?",
                (rs, i) -> toBatchDto(rs), batchId);
        if (rows.isEmpty()) throw new BusinessRuleException("Batch not found", "BATCH_NOT_FOUND");
        return rows.get(0);
    }

    private BatchDto toBatchDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new BatchDto(
                rs.getObject("id", UUID.class),
                rs.getObject("company_id", UUID.class),
                rs.getObject("run_id", UUID.class),
                rs.getObject("bank_profile_id", UUID.class),
                rs.getString("batch_reference"),
                rs.getBigDecimal("total_amount"),
                rs.getInt("beneficiary_count"),
                rs.getString("status"),
                ts(rs.getTimestamp("file_generated_at")),
                ts(rs.getTimestamp("posted_at")),
                ts(rs.getTimestamp("paid_at")),
                rs.getString("payment_reference"),
                rs.getString("notes"),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private static String csvEsc(String s) {
        if (s == null) return "";
        if (s.indexOf(',') < 0 && s.indexOf('"') < 0 && s.indexOf('\n') < 0) return s;
        return "\"" + s.replace("\"", "\"\"") + "\"";
    }

    /** "PAYROLL-AUG26-<8char-random>" — human-readable + unique. */
    private static String buildBatchReference(int month, int year) {
        String monthAbbr = YearMonth.of(year, month)
                .getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
                .toUpperCase(Locale.ENGLISH);
        String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ENGLISH);
        return "PAYROLL-" + monthAbbr + String.valueOf(year).substring(2) + "-" + suffix;
    }

    /** Mask an encrypted account payload for display. Only the last-4 was ever
     *  plaintext, and the payload here is encrypted, so we just show a fixed
     *  redacted string. The DTO caller can substitute the real last-4 if
     *  it has plaintext access. */
    private static String maskAccount(String encryptedOrEmpty) {
        if (encryptedOrEmpty == null || encryptedOrEmpty.isEmpty()) return "";
        return "•••• (encrypted)";
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
