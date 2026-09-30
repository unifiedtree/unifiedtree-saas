package com.hrms.expense.service;

import com.hrms.expense.dto.ExpenseCategoryCap;
import com.hrms.expense.dto.ExpensePolicyCheck;
import com.hrms.expense.dto.ExpensePolicyCheck.CategoryLine;
import com.hrms.expense.entity.ExpensePolicy;
import com.hrms.expense.enums.ExpenseCategory;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Reads a company's active expense policies the way the submit step does
 * ({@code ExpenseService.enforceCategoryCaps}) and checks a claim against them,
 * for the pages to show (redesign BW-60). It never refuses anything: the submit
 * step stays the only place a claim over its cap is refused.
 *
 * <p>The merge, as at submit: per category, the tightest {@code maxAmountPerClaim}
 * of the active policies wins (a policy without a cap doesn't limit), and the
 * cap applies to the claim's subtotal for that category, not to each line.
 * Added here for display: the policy that sets that cap, and whether any
 * active policy for the category expects a receipt ({@code requiresReceipt}
 * is not enforced at submit; it is only reported).
 */
public final class ExpensePolicyEvaluator {

    private ExpensePolicyEvaluator() {
    }

    /** One category of a claim: its subtotal, how many lines it has and how many carry a receipt. */
    public record CategoryTotal(ExpenseCategory category, BigDecimal subtotal, int lines, int linesWithReceipt) {
    }

    /**
     * Per category, what the active policies allow. Policies are read in the
     * order given (the repository orders by name), so on equal caps the first
     * one by name is named. Inactive policies and policies without a category
     * are ignored, as at submit.
     */
    public static Map<ExpenseCategory, ExpenseCategoryCap> caps(Collection<ExpensePolicy> policies) {
        Map<ExpenseCategory, ExpenseCategoryCap> out = new EnumMap<>(ExpenseCategory.class);
        if (policies == null) return out;
        for (ExpensePolicy p : policies) {
            if (p == null || !p.isActive() || p.getCategory() == null) continue;
            ExpenseCategoryCap was = out.get(p.getCategory());
            BigDecimal cap = p.getMaxAmountPerClaim();
            if (was == null) {
                out.put(p.getCategory(), new ExpenseCategoryCap(p.getCategory(), cap, p.getName(), p.isRequiresReceipt()));
                continue;
            }
            boolean receipt = was.requiresReceipt() || p.isRequiresReceipt();
            boolean tighter = cap != null && (was.maxAmountPerClaim() == null || cap.compareTo(was.maxAmountPerClaim()) < 0);
            out.put(p.getCategory(), tighter
                    ? new ExpenseCategoryCap(p.getCategory(), cap, p.getName(), receipt)
                    : new ExpenseCategoryCap(p.getCategory(), was.maxAmountPerClaim(), was.policyName(), receipt));
        }
        return out;
    }

    /** The categories of a claim's lines, adding up amounts and receipts (lines without a category or amount are left out, as at submit). */
    public static List<CategoryTotal> totals(Collection<Line> lines) {
        Map<ExpenseCategory, CategoryTotal> by = new EnumMap<>(ExpenseCategory.class);
        if (lines != null) {
            for (Line l : lines) {
                if (l == null || l.category() == null || l.amount() == null) continue;
                CategoryTotal was = by.get(l.category());
                by.put(l.category(), was == null
                        ? new CategoryTotal(l.category(), l.amount(), 1, l.hasReceipt() ? 1 : 0)
                        : new CategoryTotal(l.category(), was.subtotal().add(l.amount()), was.lines() + 1,
                                was.linesWithReceipt() + (l.hasReceipt() ? 1 : 0)));
            }
        }
        return new ArrayList<>(by.values());
    }

    /** One line of a claim. */
    public record Line(ExpenseCategory category, BigDecimal amount, boolean hasReceipt) {
    }

    /** The claim's categories against the caps; see {@link ExpensePolicyCheck} for the result. */
    public static ExpensePolicyCheck check(Map<ExpenseCategory, ExpenseCategoryCap> caps, Collection<CategoryTotal> totals) {
        Map<ExpenseCategory, CategoryTotal> ordered = new EnumMap<>(ExpenseCategory.class);
        if (totals != null) {
            for (CategoryTotal t : totals) {
                if (t != null && t.category() != null && t.subtotal() != null) ordered.put(t.category(), t);
            }
        }
        List<CategoryLine> lines = new ArrayList<>();
        for (CategoryTotal t : ordered.values()) {
            ExpenseCategoryCap c = caps == null ? null : caps.get(t.category());
            int missing = Math.max(0, t.lines() - t.linesWithReceipt());
            String result;
            if (c == null) result = ExpensePolicyCheck.NO_POLICY;
            else if (c.maxAmountPerClaim() != null && t.subtotal().compareTo(c.maxAmountPerClaim()) > 0) result = ExpensePolicyCheck.OVER_LIMIT;
            else if (c.requiresReceipt() && missing > 0) result = ExpensePolicyCheck.RECEIPT_MISSING;
            else result = ExpensePolicyCheck.WITHIN;
            lines.add(new CategoryLine(t.category(), t.subtotal(), c == null ? null : c.maxAmountPerClaim(),
                    c == null ? null : c.policyName(), c != null && c.requiresReceipt(), missing, result));
        }
        CategoryLine lead = first(lines, ExpensePolicyCheck.OVER_LIMIT);
        if (lead == null) lead = first(lines, ExpensePolicyCheck.RECEIPT_MISSING);
        if (lead != null) return new ExpensePolicyCheck(lead.result(), lead.policyName(), lead.cap(), lead.category(), lines);
        List<CategoryLine> covered = lines.stream().filter(l -> !ExpensePolicyCheck.NO_POLICY.equals(l.result())).toList();
        if (covered.isEmpty()) return new ExpensePolicyCheck(ExpensePolicyCheck.NO_POLICY, null, null, null, lines);
        CategoryLine only = covered.size() == 1 ? covered.get(0) : null;
        return new ExpensePolicyCheck(ExpensePolicyCheck.WITHIN, only == null ? null : only.policyName(),
                only == null ? null : only.cap(), only == null ? null : only.category(), lines);
    }

    private static CategoryLine first(List<CategoryLine> lines, String result) {
        for (CategoryLine l : lines) if (result.equals(l.result())) return l;
        return null;
    }
}
