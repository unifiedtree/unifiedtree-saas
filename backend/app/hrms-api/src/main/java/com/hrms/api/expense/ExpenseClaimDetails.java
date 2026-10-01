package com.hrms.api.expense;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.tenant.TenantContext;
import com.hrms.expense.dto.ExpenseCategoryCap;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpensePolicyCheck;
import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.service.ExpensePolicyEvaluator;
import com.hrms.expense.service.ExpensePolicyEvaluator.CategoryTotal;
import com.hrms.expense.service.ExpenseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * The expense pages' extra facts (redesign BW-60), read from the existing
 * expense tables with JDBC; nothing here writes.
 * <ul>
 *   <li>{@link #add}: each claim's department, approver name, categories,
 *       reimbursement batch and policy check;</li>
 *   <li>{@link #mySummary}: the claimant's totals across all their claims
 *       (the list is paged, so the page can't add them up itself).</li>
 * </ul>
 * Every statement also filters {@code tenant_id}. The claim fields are optional:
 * a part that can't be read because a table or column is missing is left null
 * (logged as a WARN, like FEATURE_NOT_READY), and the claim list still loads.
 * Any other database error fails the request as before.
 */
@Component
public class ExpenseClaimDetails {

    private static final Logger log = LoggerFactory.getLogger(ExpenseClaimDetails.class);
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final ExpenseService expenses;

    public ExpenseClaimDetails(JdbcTemplate jdbc, ExpenseService expenses) {
        this.jdbc = jdbc;
        this.expenses = expenses;
    }

    // ── the claims' detail fields ────────────────────────────────────────────

    /** The person facts the claim rows show. */
    record Person(String name, String department) {
    }

    /** The reimbursement batch a claim sits in. */
    record Batch(String reference, String status) {
    }

    /** {@code claims} with department, approver name, categories, batch and policy check filled in, in the same order. */
    public List<ExpenseClaimResponse> add(List<ExpenseClaimResponse> claims) {
        if (claims == null || claims.isEmpty()) return claims;
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) return claims;
        List<UUID> claimIds = claims.stream().map(ExpenseClaimResponse::id).filter(Objects::nonNull).distinct().toList();
        Set<UUID> people = new LinkedHashSet<>();
        Set<UUID> companies = new LinkedHashSet<>();
        for (ExpenseClaimResponse c : claims) {
            if (c.employeeId() != null) people.add(c.employeeId());
            if (c.approverId() != null) people.add(c.approverId());
            if (c.companyId() != null) companies.add(c.companyId());
        }
        Map<UUID, Person> persons = optional("people", () -> people(tenantId, people));
        Map<UUID, List<CategoryTotal>> totals = optional("lines", () -> totals(tenantId, claimIds));
        Map<UUID, Batch> batches = optional("batches", () -> batches(tenantId, claimIds));
        Map<UUID, Map<ExpenseCategory, ExpenseCategoryCap>> caps = optional("policies", () -> expenses.capsByCompany(companies));

        List<ExpenseClaimResponse> out = new ArrayList<>(claims.size());
        for (ExpenseClaimResponse c : claims) {
            Person claimant = persons == null ? null : persons.get(c.employeeId());
            Person approver = persons == null || c.approverId() == null ? null : persons.get(c.approverId());
            List<CategoryTotal> lines = totals == null ? null : totals.getOrDefault(c.id(), List.of());
            List<ExpenseCategory> categories = lines == null ? null : lines.stream().map(CategoryTotal::category).toList();
            Batch batch = batches == null ? null : batches.get(c.id());
            ExpensePolicyCheck check = lines == null || caps == null ? null
                    : ExpensePolicyEvaluator.check(caps.getOrDefault(c.companyId(), Map.of()), lines);
            out.add(c.withDetails(
                    claimant == null ? null : claimant.department(),
                    approver == null ? null : approver.name(),
                    categories,
                    batch == null ? null : batch.reference(),
                    batch == null ? null : batch.status(),
                    check));
        }
        return out;
    }

    Map<UUID, Person> people(UUID tenantId, Collection<UUID> ids) {
        Map<UUID, Person> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query("""
                SELECT e.id,
                       NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS name,
                       d.name AS department
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[]))
                """, (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class),
                        new Person(rs.getString("name"), rs.getString("department"))),
                tenantId, uuidArray(ids));
        return out;
    }

    /** Per claim, its lines by category: subtotal, line count and lines with a receipt (blank counts as none). */
    Map<UUID, List<CategoryTotal>> totals(UUID tenantId, Collection<UUID> claimIds) {
        Map<UUID, List<CategoryTotal>> out = new HashMap<>();
        if (claimIds.isEmpty()) return out;
        jdbc.query("""
                SELECT i.claim_id, i.category, SUM(i.amount) AS subtotal, COUNT(*) AS line_count,
                       COUNT(NULLIF(btrim(i.receipt_url), '')) AS with_receipt
                  FROM expense_mgmt.expense_items i
                 WHERE i.tenant_id = ? AND i.claim_id = ANY(CAST(? AS uuid[]))
                   AND i.category IS NOT NULL AND i.amount IS NOT NULL
                 GROUP BY i.claim_id, i.category
                """, (RowCallbackHandler) rs -> {
                    ExpenseCategory category = category(rs.getString("category"));
                    if (category == null) return;
                    out.computeIfAbsent(rs.getObject("claim_id", UUID.class), k -> new ArrayList<>())
                            .add(new CategoryTotal(category, rs.getBigDecimal("subtotal"), rs.getInt("line_count"),
                                    rs.getInt("with_receipt")));
                }, tenantId, uuidArray(claimIds));
        // Category order, as the policy check lists them.
        out.replaceAll((k, v) -> v.stream().sorted((a, b) -> a.category().compareTo(b.category())).toList());
        return out;
    }

    /** Per claim, the newest reimbursement batch it is in that wasn't cancelled (a claim is in at most one). */
    Map<UUID, Batch> batches(UUID tenantId, Collection<UUID> claimIds) {
        Map<UUID, Batch> out = new HashMap<>();
        if (claimIds.isEmpty()) return out;
        jdbc.query("""
                SELECT DISTINCT ON (bi.claim_id) bi.claim_id, b.batch_reference, b.status
                  FROM expense_mgmt.reimbursement_batch_items bi
                  JOIN expense_mgmt.reimbursement_batches b ON b.id = bi.batch_id AND b.tenant_id = bi.tenant_id
                 WHERE bi.tenant_id = ? AND bi.claim_id = ANY(CAST(? AS uuid[])) AND b.status <> 'CANCELLED'
                 ORDER BY bi.claim_id, b.created_at DESC
                """, (RowCallbackHandler) rs -> out.put(rs.getObject("claim_id", UUID.class),
                        new Batch(rs.getString("batch_reference"), rs.getString("status"))),
                tenantId, uuidArray(claimIds));
        return out;
    }

    // ── my totals ────────────────────────────────────────────────────────────

    /** A number of claims and what they add up to. */
    public record Bucket(long count, BigDecimal amount) {
        static final Bucket NONE = new Bucket(0, BigDecimal.ZERO);

        Bucket plus(long n, BigDecimal a) {
            return new Bucket(count + n, amount.add(a == null ? BigDecimal.ZERO : a));
        }
    }

    /** The three totals in one currency. */
    public record CurrencyTotals(String currency, Bucket waiting, Bucket approvedNotPaid, Bucket reimbursedThisYear) {
    }

    /**
     * The claimant's totals across all their claims (GET /v1/expense/my/summary):
     * <ul>
     *   <li>{@code waiting}: SUBMITTED, waiting for a decision;</li>
     *   <li>{@code approvedNotPaid}: APPROVED or APPROVED_FOR_PAY (in a posted
     *       reimbursement batch), not paid yet;</li>
     *   <li>{@code reimbursedThisYear}: REIMBURSED this calendar year (India time);</li>
     *   <li>{@code claimsThisYear}: claims raised this calendar year, any status.</li>
     * </ul>
     * Amounts are in {@code currency}, the currency most of these claims use
     * (INR when there are none); claims in any other currency are totalled
     * separately in {@code otherCurrencies}, never added together.
     * {@code waitingApproverName} is set when every waiting claim is with the same person.
     */
    public record MySummary(int year, String currency, Bucket waiting, Bucket approvedNotPaid, Bucket reimbursedThisYear,
                            long claimsThisYear, UUID waitingApproverId, String waitingApproverName,
                            List<CurrencyTotals> otherCurrencies) {
    }

    public MySummary mySummary(UUID employeeId, LocalDate today) {
        // Existing tables only; a missing one answers FEATURE_NOT_READY (503), not a 500.
        return FeatureNotReady.guard(() -> summary(employeeId, today));
    }

    private MySummary summary(UUID employeeId, LocalDate today) {
        UUID tenantId = TenantContext.getTenantId();
        int year = today.getYear();
        java.sql.Timestamp from = java.sql.Timestamp.from(LocalDate.of(year, 1, 1).atStartOfDay(IST).toInstant());
        java.sql.Timestamp to = java.sql.Timestamp.from(LocalDate.of(year + 1, 1, 1).atStartOfDay(IST).toInstant());
        Map<String, Bucket[]> byCurrency = new LinkedHashMap<>();
        Set<UUID> waitingApprovers = new LinkedHashSet<>();
        boolean[] waitingUnrouted = {false};
        jdbc.query("""
                SELECT status, COALESCE(NULLIF(btrim(currency), ''), 'INR') AS currency, approver_id,
                       COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS amount
                  FROM expense_mgmt.expense_claims
                 WHERE tenant_id = ? AND employee_id = ?
                   AND (status IN ('SUBMITTED', 'APPROVED', 'APPROVED_FOR_PAY')
                        OR (status = 'REIMBURSED' AND reimbursed_at >= ? AND reimbursed_at < ?))
                 GROUP BY status, 2, approver_id
                """, (RowCallbackHandler) rs -> {
                    String status = rs.getString("status");
                    Bucket[] b = byCurrency.computeIfAbsent(rs.getString("currency").toUpperCase(java.util.Locale.ROOT),
                            k -> new Bucket[]{Bucket.NONE, Bucket.NONE, Bucket.NONE});
                    int slot = switch (status) {
                        case "SUBMITTED" -> 0;
                        case "APPROVED", "APPROVED_FOR_PAY" -> 1;
                        default -> 2;
                    };
                    b[slot] = b[slot].plus(rs.getLong("n"), rs.getBigDecimal("amount"));
                    if (slot == 0) {
                        UUID approver = rs.getObject("approver_id", UUID.class);
                        if (approver == null) waitingUnrouted[0] = true;
                        else waitingApprovers.add(approver);
                    }
                }, tenantId, employeeId, from, to);
        Long raised = jdbc.queryForObject("""
                SELECT COUNT(*) FROM expense_mgmt.expense_claims
                 WHERE tenant_id = ? AND employee_id = ? AND status <> 'DRAFT'
                   AND COALESCE(submitted_at, created_at) >= ? AND COALESCE(submitted_at, created_at) < ?
                """, Long.class, tenantId, employeeId, from, to);

        String main = byCurrency.entrySet().stream()
                .max((a, b) -> {
                    int byCount = Long.compare(total(a.getValue()), total(b.getValue()));
                    if (byCount != 0) return byCount;
                    return Boolean.compare("INR".equals(a.getKey()), "INR".equals(b.getKey()));
                })
                .map(Map.Entry::getKey).orElse("INR");
        Bucket[] m = byCurrency.getOrDefault(main, new Bucket[]{Bucket.NONE, Bucket.NONE, Bucket.NONE});
        List<CurrencyTotals> others = byCurrency.entrySet().stream()
                .filter(e -> !e.getKey().equals(main))
                .map(e -> new CurrencyTotals(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2]))
                .collect(Collectors.toList());
        UUID approverId = !waitingUnrouted[0] && waitingApprovers.size() == 1 ? waitingApprovers.iterator().next() : null;
        String approverName = null;
        if (approverId != null) {
            Person p = people(tenantId, List.of(approverId)).get(approverId);
            approverName = p == null ? null : p.name();
        }
        return new MySummary(year, main, m[0], m[1], m[2], raised == null ? 0 : raised, approverId, approverName, others);
    }

    private static long total(Bucket[] b) {
        return b[0].count() + b[1].count() + b[2].count();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * Runs one optional part. A missing table or column leaves that part null
     * (with the same WARN FEATURE_NOT_READY logs); every other error is rethrown.
     */
    static <T> T optional(String part, Supplier<T> work) {
        try {
            return work.get();
        } catch (DataAccessException e) {
            if (!FeatureNotReady.isMissingSchema(e)) throw e;
            log.warn("Expense claim details: the {} part is left out because a table or column is missing: {}. "
                    + "If the expense tables are all there, this is a bug.", part, e.getMostSpecificCause().getMessage());
            return null;
        }
    }

    private static ExpenseCategory category(String raw) {
        if (raw == null) return null;
        try {
            return ExpenseCategory.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    static String uuidArray(Collection<UUID> ids) {
        return ids.stream().filter(Objects::nonNull).map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }
}
