package com.hrms.api.expense;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.expense.dto.ExpenseCategoryCap;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseItemRequest;
import com.hrms.expense.dto.ExpensePolicyCheck;
import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.entity.ExpensePolicy;
import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.repository.ExpenseClaimRepository;
import com.hrms.expense.repository.ExpenseItemRepository;
import com.hrms.expense.repository.ExpensePolicyRepository;
import com.hrms.expense.service.ExpensePolicyEvaluator;
import com.hrms.expense.service.ExpensePolicyEvaluator.CategoryTotal;
import com.hrms.expense.service.ExpensePolicyEvaluator.Line;
import com.hrms.expense.service.ExpenseService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

import static com.hrms.expense.enums.ExpenseCategory.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The policy check shown on claims (redesign BW-60) reads the caps exactly as
 * the submit step enforces them: tightest active cap per category, applied to
 * the category's subtotal.
 */
class ExpensePolicyCheckTest {

    private static ExpensePolicy policy(String name, ExpenseCategory category, String cap, boolean receipt, boolean active) {
        ExpensePolicy p = new ExpensePolicy();
        p.setName(name);
        p.setCategory(category);
        p.setMaxAmountPerClaim(cap == null ? null : new BigDecimal(cap));
        p.setRequiresReceipt(receipt);
        p.setActive(active);
        return p;
    }

    private static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }

    // ── the caps merge ───────────────────────────────────────────────────────

    @Test void theTightestActiveCapWinsAndNamesItsPolicy() {
        Map<ExpenseCategory, ExpenseCategoryCap> caps = ExpensePolicyEvaluator.caps(List.of(
                policy("A travel", TRAVEL, "5000", false, true),
                policy("B travel", TRAVEL, "3000", false, true),
                policy("C travel (off)", TRAVEL, "100", true, false),
                policy("D travel no cap", TRAVEL, null, true, true),
                policy("Meals", FOOD, null, false, true)));
        ExpenseCategoryCap travel = caps.get(TRAVEL);
        assertEquals(0, bd("3000").compareTo(travel.maxAmountPerClaim()));
        assertEquals("B travel", travel.policyName());
        assertTrue(travel.requiresReceipt(), "any active policy that expects a receipt counts; the inactive one doesn't");
        ExpenseCategoryCap food = caps.get(FOOD);
        assertNull(food.maxAmountPerClaim(), "a policy without a cap doesn't limit");
        assertEquals("Meals", food.policyName());
        assertFalse(caps.containsKey(MEDICAL));
    }

    @Test void onEqualCapsTheFirstPolicyByNameIsNamed() {
        Map<ExpenseCategory, ExpenseCategoryCap> caps = ExpensePolicyEvaluator.caps(List.of(
                policy("Alpha", TRAVEL, "1000", false, true), policy("Beta", TRAVEL, "1000.00", false, true)));
        assertEquals("Alpha", caps.get(TRAVEL).policyName());
    }

    // ── the check ────────────────────────────────────────────────────────────

    @Test void theCapAppliesToTheCategorySubtotalNotEachLine() {
        var caps = ExpensePolicyEvaluator.caps(List.of(policy("Meals", FOOD, "1000", false, true)));
        // Three lines of 400: each is under 1,000, the subtotal (1,200) is over.
        var totals = ExpensePolicyEvaluator.totals(List.of(
                new Line(FOOD, bd("400"), true), new Line(FOOD, bd("400"), true), new Line(FOOD, bd("400"), true)));
        ExpensePolicyCheck c = ExpensePolicyEvaluator.check(caps, totals);
        assertEquals(ExpensePolicyCheck.OVER_LIMIT, c.result());
        assertEquals("Meals", c.policyName());
        assertEquals(0, bd("1000").compareTo(c.cap()));
        assertEquals(FOOD, c.category());
        assertEquals(0, bd("1200").compareTo(c.lines().get(0).subtotal()));
    }

    @Test void withinOneCoveredCategoryNamesThatPolicy() {
        var caps = ExpensePolicyEvaluator.caps(List.of(policy("Local travel", TRAVEL, "1500", false, true)));
        ExpensePolicyCheck c = ExpensePolicyEvaluator.check(caps, List.of(new CategoryTotal(TRAVEL, bd("1500"), 1, 0)));
        assertEquals(ExpensePolicyCheck.WITHIN, c.result(), "exactly the cap is within");
        assertEquals("Local travel", c.policyName());
        assertEquals(TRAVEL, c.category());
    }

    @Test void aMissingReceiptIsReportedOnlyWhereAPolicyExpectsOne() {
        var caps = ExpensePolicyEvaluator.caps(List.of(
                policy("Travel", TRAVEL, "5000", true, true), policy("Meals", FOOD, "5000", false, true)));
        ExpensePolicyCheck missing = ExpensePolicyEvaluator.check(caps, List.of(
                new CategoryTotal(FOOD, bd("100"), 2, 0), new CategoryTotal(TRAVEL, bd("100"), 2, 1)));
        assertEquals(ExpensePolicyCheck.RECEIPT_MISSING, missing.result());
        assertEquals(TRAVEL, missing.category());
        assertEquals(1, missing.lines().stream().filter(l -> l.category() == TRAVEL).findFirst().orElseThrow().missingReceipts());
        assertEquals(ExpensePolicyCheck.WITHIN, missing.lines().stream().filter(l -> l.category() == FOOD).findFirst().orElseThrow().result());

        ExpensePolicyCheck fine = ExpensePolicyEvaluator.check(caps, List.of(
                new CategoryTotal(FOOD, bd("100"), 2, 0), new CategoryTotal(TRAVEL, bd("100"), 2, 2)));
        assertEquals(ExpensePolicyCheck.WITHIN, fine.result());
        assertNull(fine.policyName(), "two covered categories: no single policy to name");
        assertEquals(2, fine.lines().size());
    }

    @Test void overTheLimitComesBeforeAMissingReceipt() {
        var caps = ExpensePolicyEvaluator.caps(List.of(
                policy("Travel", TRAVEL, "5000", true, true), policy("Meals", FOOD, "500", false, true)));
        ExpensePolicyCheck c = ExpensePolicyEvaluator.check(caps, List.of(
                new CategoryTotal(TRAVEL, bd("100"), 1, 0), new CategoryTotal(FOOD, bd("600"), 1, 1)));
        assertEquals(ExpensePolicyCheck.OVER_LIMIT, c.result());
        assertEquals(FOOD, c.category());
    }

    @Test void noPolicyForTheClaimsCategories() {
        var caps = ExpensePolicyEvaluator.caps(List.of(policy("Travel", TRAVEL, "5000", true, true)));
        ExpensePolicyCheck c = ExpensePolicyEvaluator.check(caps, List.of(new CategoryTotal(MEDICAL, bd("100"), 1, 0)));
        assertEquals(ExpensePolicyCheck.NO_POLICY, c.result());
        assertNull(c.policyName());
        assertEquals(ExpensePolicyCheck.NO_POLICY, ExpensePolicyEvaluator.check(Map.of(), List.of()).result());
    }

    @Test void linesWithoutACategoryOrAmountAreLeftOutAsAtSubmit() {
        var totals = ExpensePolicyEvaluator.totals(java.util.Arrays.asList(
                new Line(null, bd("100"), false), new Line(TRAVEL, null, false), new Line(TRAVEL, bd("5"), false), null));
        assertEquals(1, totals.size());
        assertEquals(1, totals.get(0).lines());
    }

    // ── the same answer as the submit step ──────────────────────────────────

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final ExpenseClaimRepository claims = mock(ExpenseClaimRepository.class);
    private final ExpensePolicyRepository policies = mock(ExpensePolicyRepository.class);
    private final ExpenseService service = new ExpenseService(claims, mock(ExpenseItemRepository.class), policies);

    @BeforeEach void tenant() {
        TenantContext.setTenantId(tenant);
        when(claims.save(any(ExpenseClaim.class))).thenAnswer(inv -> {
            ExpenseClaim c = inv.getArgument(0);
            c.setId(UUID.randomUUID());
            return c;
        });
    }

    @AfterEach void clear() {
        TenantContext.clear();
    }

    @Test void overLimitExactlyWhenSubmitRefusesTheClaim() {
        Random random = new Random(20260927);
        ExpenseCategory[] cats = {TRAVEL, FOOD, MEDICAL};
        for (int round = 0; round < 300; round++) {
            List<ExpensePolicy> active = new ArrayList<>();
            int n = random.nextInt(4);
            for (int i = 0; i < n; i++) {
                active.add(policy("P" + i, cats[random.nextInt(cats.length)],
                        random.nextInt(4) == 0 ? null : String.valueOf(100 * (1 + random.nextInt(10))), random.nextBoolean(), true));
            }
            List<ExpenseItemRequest> items = new ArrayList<>();
            List<Line> lines = new ArrayList<>();
            int m = 1 + random.nextInt(4);
            for (int i = 0; i < m; i++) {
                ExpenseCategory cat = cats[random.nextInt(cats.length)];
                BigDecimal amount = BigDecimal.valueOf(50L * (1 + random.nextInt(20)));
                items.add(new ExpenseItemRequest(cat, "line", amount, LocalDate.now(), null, null));
                lines.add(new Line(cat, amount, false));
            }
            when(policies.findByCompanyIdAndActiveTrueOrderByName(company)).thenReturn(active);
            boolean refused;
            try {
                service.submitClaim(UUID.randomUUID(), company, new ExpenseClaimRequest(company, "t", "INR", null, items), null);
                refused = false;
            } catch (BusinessRuleException e) {
                assertEquals("EXPENSE_POLICY_CAP_EXCEEDED", e.getErrorCode());
                refused = true;
            }
            ExpensePolicyCheck check = ExpensePolicyEvaluator.check(ExpensePolicyEvaluator.caps(active), ExpensePolicyEvaluator.totals(lines));
            assertEquals(refused, ExpensePolicyCheck.OVER_LIMIT.equals(check.result()),
                    "round " + round + ": policies " + active.size() + ", check " + check);
        }
    }

    @Test void categoryCapsListsWhatSubmitEnforces() {
        when(policies.findByCompanyIdAndActiveTrueOrderByName(company)).thenReturn(List.of(
                policy("Travel wide", TRAVEL, "9000", false, true), policy("Travel tight", TRAVEL, "2000", true, true)));
        List<ExpenseCategoryCap> caps = service.categoryCaps(company);
        assertEquals(1, caps.size());
        assertEquals("Travel tight", caps.get(0).policyName());
        assertTrue(caps.get(0).requiresReceipt());
        assertEquals(List.of(), service.categoryCaps(null));
    }
}
