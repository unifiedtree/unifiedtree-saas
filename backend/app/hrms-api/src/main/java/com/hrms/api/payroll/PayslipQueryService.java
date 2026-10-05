package com.hrms.api.payroll;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * "Ask payroll" (BW-59): an employee asks the payroll team about one of their
 * own LOCKED or PAID payslips; someone holding payroll.runs.manage, or the
 * narrower payroll.queries.answer (V143.86, HR), answers.
 *
 * <ul>
 *   <li>Own payslips only: a run that isn't the caller's, or isn't final yet,
 *       is "No payslip for this period" (404), the same answer as opening it.</li>
 *   <li>A question is answered once. A second answer is refused (409), so two
 *       people answering at the same time can't overwrite each other.</li>
 *   <li>The payroll team is told a question is waiting, and the employee that
 *       it was answered. Neither notification carries the text.</li>
 *   <li>"Remove" takes an answered question off the queue: it is marked CLOSED,
 *       never deleted (the runtime role has no DELETE on the table). An open
 *       question can't be removed (409). The employee still sees a removed
 *       question as answered, with its answer.</li>
 *   <li>While V143.58 isn't applied, every call answers 503 FEATURE_NOT_READY.</li>
 * </ul>
 */
@Service
public class PayslipQueryService {

    private static final Logger log = LoggerFactory.getLogger(PayslipQueryService.class);

    /**
     * Who is told about a new question, and who may answer it (the same codes
     * as PayslipQueryController.ANSWER_GUARD): the payroll team first, then
     * holders of payroll.queries.answer (V143.86). Until V143.86 is applied no
     * one holds the second, so it simply adds no one.
     */
    static final List<String> ANSWER_PERMISSIONS = List.of("payroll.runs.manage", "payroll.queries.answer");
    static final int MAX_MESSAGE = 1000;
    static final int MAX_ANSWER = 2000;
    /** At most this many payroll people are told about one question. */
    static final int MAX_RECIPIENTS = 25;
    static final Set<String> STATUSES = Set.of("OPEN", "ANSWERED", "CLOSED");

    private final JdbcTemplate jdbc;
    private final PayslipQueryStore store;
    private final PayslipQueryNotifier notifier;
    private final AuditService audit;

    public PayslipQueryService(JdbcTemplate jdbc, PayslipQueryStore store, PayslipQueryNotifier notifier,
                               AuditService audit) {
        this.jdbc = jdbc;
        this.store = store;
        this.notifier = notifier;
        this.audit = audit;
    }

    /**
     * One question. {@code answeredByName} is the answering person's name (no
     * email); {@code companyName} tells companies apart for the payroll team.
     */
    public record PayslipQueryDto(UUID id, UUID runId, String period, int periodMonth, int periodYear,
                                  UUID employeeId, String employeeName, String employeeCode,
                                  UUID companyId, String companyName, String message, String status,
                                  String answer, String answeredByName, String answeredAt, String createdAt) {}

    // ── The employee's side ───────────────────────────────────────────────────

    @Transactional
    public PayslipQueryDto raise(UUID tenantId, UUID userId, UUID employeeId, UUID runId, String message) {
        bindTenant(tenantId);
        String text = clean(message, MAX_MESSAGE, "QUESTION_REQUIRED", "Write your question.",
                "QUESTION_TOO_LONG", "Keep the question under " + MAX_MESSAGE + " characters.");
        PayslipQueryStore.OwnPayslip slip = employeeId == null ? null
                : store.ownPayslip(tenantId, employeeId, runId).orElse(null);
        if (slip == null) {
            throw new HrmsException("No payslip for this period", HttpStatus.NOT_FOUND, "PAYSLIP_NOT_FOUND");
        }
        UUID id = store.insert(tenantId, slip, employeeId, text, userId);
        PayslipQueryStore.QueryRow row = store.find(tenantId, id)
                .orElseThrow(() -> new IllegalStateException("Payslip question " + id + " not found after insert"));
        List<UUID> team = answerers(tenantId, employeeId);
        notifier.raised(tenantId, team, row.employeeName(), row.period(), id, slip.runId());
        return dto(row);
    }

    @Transactional
    public List<PayslipQueryDto> mine(UUID tenantId, UUID employeeId, UUID runId) {
        bindTenant(tenantId);
        if (employeeId == null) return List.of();
        return store.listForEmployee(tenantId, employeeId, runId, 200).stream().map(PayslipQueryService::forAsker).toList();
    }

    // ── The payroll team's side ───────────────────────────────────────────────

    @Transactional
    public List<PayslipQueryDto> list(UUID tenantId, String status, Integer limit) {
        bindTenant(tenantId);
        String s = status == null || status.isBlank() ? null : status.trim().toUpperCase(java.util.Locale.ROOT);
        if (s != null && !STATUSES.contains(s)) {
            throw new HrmsException("Status must be OPEN, ANSWERED or CLOSED", HttpStatus.BAD_REQUEST, "INVALID_STATUS");
        }
        int n = limit == null ? 200 : Math.max(1, Math.min(500, limit));
        return store.list(tenantId, s, n).stream().map(PayslipQueryService::dto).toList();
    }

    @Transactional
    public PayslipQueryDto answer(UUID tenantId, UUID userId, UUID answererEmployeeId, UUID id, String answer) {
        bindTenant(tenantId);
        String text = clean(answer, MAX_ANSWER, "ANSWER_REQUIRED", "Write an answer.",
                "ANSWER_TOO_LONG", "Keep the answer under " + MAX_ANSWER + " characters.");
        PayslipQueryStore.QueryRow row = store.find(tenantId, id)
                .orElseThrow(() -> new HrmsException("Question not found", HttpStatus.NOT_FOUND, "QUERY_NOT_FOUND"));
        if (!"OPEN".equals(row.status()) || !store.answer(tenantId, id, text, userId, answererEmployeeId)) {
            throw new HrmsException("This question has already been answered", HttpStatus.CONFLICT,
                    "QUERY_ALREADY_ANSWERED");
        }
        PayslipQueryStore.QueryRow answered = store.find(tenantId, id).orElse(row);
        try {
            // The audit trail records who answered whom, never the text (it may quote pay details).
            audit.record("payroll", "PAYSLIP_QUERY_ANSWERED", "payslip_query", id,
                    "Answered %s's question about their %s payslip".formatted(
                            answered.employeeName() == null ? "an employee" : answered.employeeName(), answered.period()));
        } catch (Exception e) {
            log.warn("Audit for payslip question {} failed: {}", id, e.getMessage());
        }
        String by = store.accountName(tenantId, userId);
        notifier.answered(tenantId, answered.employeeId(), by, answered.period(), id, answered.runId());
        return dto(answered);
    }

    /**
     * "Remove": takes an answered question off the payroll team's queue (status
     * CLOSED). Another workspace's question, or one that isn't there, is 404; an
     * open one is 409 (answer it first). Removing it twice is not an error.
     */
    @Transactional
    public void remove(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        PayslipQueryStore.QueryRow row = store.find(tenantId, id)
                .orElseThrow(() -> new HrmsException("Question not found", HttpStatus.NOT_FOUND, "QUERY_NOT_FOUND"));
        if ("OPEN".equals(row.status())) {
            throw new HrmsException("Answer this question before removing it", HttpStatus.CONFLICT, "QUERY_NOT_ANSWERED");
        }
        if (!store.close(tenantId, id)) return; // already removed
        try {
            // Who removed whose question, never the text.
            audit.record("payroll", "PAYSLIP_QUERY_REMOVED", "payslip_query", id,
                    "Removed %s's answered question about their %s payslip from the queue".formatted(
                            row.employeeName() == null ? "an employee" : row.employeeName(), row.period()));
        } catch (Exception e) {
            log.warn("Audit for removing payslip question {} failed: {}", id, e.getMessage());
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** Everyone who may answer, each once, the payroll team first, at most MAX_RECIPIENTS; never the asker. */
    List<UUID> answerers(UUID tenantId, UUID asker) {
        Set<UUID> people = new LinkedHashSet<>();
        for (String permission : ANSWER_PERMISSIONS) {
            if (people.size() >= MAX_RECIPIENTS) break;
            people.addAll(store.employeesHolding(tenantId, permission, asker, MAX_RECIPIENTS));
        }
        return people.stream().limit(MAX_RECIPIENTS).toList();
    }

    /** Trimmed text, or a 400 when it is empty or too long. */
    static String clean(String value, int max, String emptyCode, String emptyMessage, String longCode, String longMessage) {
        String t = value == null ? "" : value.strip();
        if (t.isEmpty()) throw new HrmsException(emptyMessage, HttpStatus.BAD_REQUEST, emptyCode);
        if (t.length() > max) throw new HrmsException(longMessage, HttpStatus.BAD_REQUEST, longCode);
        return t;
    }

    static PayslipQueryDto dto(PayslipQueryStore.QueryRow r) {
        return dto(r, r.status());
    }

    /** The asker's view: a question the payroll team removed from its queue (CLOSED) is still answered to them. */
    static PayslipQueryDto forAsker(PayslipQueryStore.QueryRow r) {
        return dto(r, "CLOSED".equals(r.status()) && r.answer() != null ? "ANSWERED" : r.status());
    }

    private static PayslipQueryDto dto(PayslipQueryStore.QueryRow r, String status) {
        return new PayslipQueryDto(r.id(), r.runId(), r.period(), r.periodMonth(), r.periodYear(),
                r.employeeId(), r.employeeName(), r.employeeCode(), r.companyId(), r.companyName(),
                r.message(), status, r.answer(), r.answeredByName(), r.answeredAt(), r.createdAt());
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
