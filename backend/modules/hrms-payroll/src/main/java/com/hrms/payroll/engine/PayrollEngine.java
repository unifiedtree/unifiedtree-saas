package com.hrms.payroll.engine;

import com.hrms.payroll.lop.LopCalculator.LopResult;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure payroll calculation engine (Prompt 13a). NO Spring, NO database — only
 * java.math / java.time. Given an employee's earning structure, the LOP outcome
 * from {@link com.hrms.payroll.lop.LopCalculator} and the tenant's statutory
 * config, it produces a deterministic set of payslip lines and the
 * gross / deductions / net totals.
 *
 * <p>Determinism is a hard guarantee: {@code compute(in)} called twice with the
 * same input returns an {@code equals}-identical {@link PayrollResult} (records
 * give structural equality and the line order is fixed: earnings in input order,
 * then flat earnings, PF employee, PF employer, ESI employee, ESI employer, PT, LWF,
 * then flat deductions).
 *
 * <h2>Rules (encoded exactly)</h2>
 * <ol>
 *   <li><b>Earnings are pro-rated</b> by {@code paidDays / totalCalendar}; each
 *       line is rounded HALF_UP to 2 decimals.</li>
 *   <li><b>PF</b> applies only when enabled AND the employee is PF-applicable AND
 *       {@code pfStatus == ENROLLED}. Base = pro-rated BASIC, capped at the
 *       <b>flat</b> wage ceiling (NOT pro-rated). Employee + employer at their
 *       percentages.</li>
 *   <li><b>ESI</b> eligibility is decided on the <b>full (un-pro-rated)</b>
 *       monthly gross: if it exceeds the ceiling, no ESI lines at all. Otherwise
 *       both sides are charged on the <b>pro-rated</b> gross.</li>
 *   <li><b>PT</b> is the flat slab amount resolved by the caller — never
 *       pro-rated.</li>
 *   <li><b>Net</b> = gross − employee-side deductions. Employer contributions are
 *       persisted for reporting but excluded from net.</li>
 *   <li><b>Negative net</b> is allowed and surfaced as a warning, never clamped
 *       or thrown.</li>
 * </ol>
 */
public final class PayrollEngine {

    private static final int SCALE = 2;
    private static final RoundingMode RM = RoundingMode.HALF_UP;
    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(SCALE, RM);

    // Statutory line identity (codes MUST match DefaultComponentSeeder).
    private static final String PF_EMPLOYEE  = "PF_EMPLOYEE";
    private static final String PF_EMPLOYER  = "PF_EMPLOYER";
    private static final String ESI_EMPLOYEE = "ESI_EMPLOYEE";
    private static final String ESI_EMPLOYER = "ESI_EMPLOYER";
    private static final String PT           = "PT";
    private static final String CAT_EARNING       = "EARNING";
    private static final String CAT_REIMBURSEMENT = "REIMBURSEMENT";
    private static final String CAT_DEDUCTION      = "DEDUCTION";
    private static final String CAT_EMPLOYER       = "EMPLOYER_CONTRIBUTION";

    private PayrollEngine() {}

    // ── Value types ──────────────────────────────────────────────────────────

    /** A salary component definition (mirrors {@code payroll.salary_components}). */
    public record ComponentDef(String code, String name, String category, boolean statutory, int displayOrder) {
        public ComponentDef(String code, String name, String category, boolean statutory) {
            this(code, name, category, statutory, 100);
        }
    }

    /** One earning line of the employee's structure (full-month amount). */
    public record EarningLine(ComponentDef component, BigDecimal monthlyAmount) {}

    /** Tenant statutory configuration resolved for this employee/period. */
    public record StatutoryConfig(
        boolean pfEnabled, BigDecimal pfEmployeePercent, BigDecimal pfEmployerPercent,
        BigDecimal pfWageCeiling, boolean pfApplyCeiling,
        boolean esiEnabled, BigDecimal esiEmployeePercent, BigDecimal esiEmployerPercent,
        BigDecimal esiWageCeiling,
        boolean ptEnabled, BigDecimal ptAmount) {}

    /** Per-employee statutory flags from the salary structure. */
    public record EmployeeStructureCfg(String pfStatus, boolean pfApplicable, boolean esiApplicable) {}

    /** Full input to {@link #compute}. */
    public record PayrollEngineInput(
        List<EarningLine> earnings,
        LopResult lop,
        StatutoryConfig statutory,
        EmployeeStructureCfg employee,
        YearMonth period) {}

    /** One computed payslip line. */
    public record PayslipLine(String componentCode, String componentName, String category,
                              BigDecimal amount, int displayOrder) {}

    /** The computed payslip result for one employee. */
    public record PayrollResult(
        BigDecimal gross,
        BigDecimal totalDeductions,
        BigDecimal totalEmployerContrib,
        BigDecimal net,
        List<PayslipLine> lines,
        List<String> warnings) {}

    /**
     * A flat monthly amount that is never pro-rated: an approved performance
     * incentive, or a fixed-amount deduction component.
     */
    public record FlatLine(ComponentDef component, BigDecimal amount) {}

    /**
     * What payroll adds on top of the salary structure.
     * <ul>
     *   <li>{@code flatEarnings}: paid in full (not pro-rated for loss-of-pay
     *       days) and kept out of the PF and ESI wage base.</li>
     *   <li>{@code flatDeductions}: deducted in full.</li>
     *   <li>{@code lwfEmployee} / {@code lwfEmployer}: the Labour Welfare Fund
     *       contributions for this month, or null when LWF isn't due.</li>
     * </ul>
     */
    public record Extras(List<FlatLine> flatEarnings, List<FlatLine> flatDeductions,
                         BigDecimal lwfEmployee, BigDecimal lwfEmployer) {
        public static final Extras NONE = new Extras(List.of(), List.of(), null, null);
    }

    public static final String LWF_EMPLOYEE = "LWF_EMPLOYEE";
    public static final String LWF_EMPLOYER = "LWF_EMPLOYER";

    // ── Calculation ──────────────────────────────────────────────────────────

    public static PayrollResult compute(PayrollEngineInput in) {
        return compute(in, Extras.NONE);
    }

    public static PayrollResult compute(PayrollEngineInput in, Extras extras) {
        Extras ex = extras == null ? Extras.NONE : extras;
        BigDecimal paidDays = in.lop().paidDays();           // 1dp from LopCalculator
        BigDecimal totalDays = new BigDecimal(in.lop().totalCalendar());

        List<PayslipLine> lines = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        // ── 1. Earnings (pro-rated) ──────────────────────────────────────────
        BigDecimal gross = ZERO;
        BigDecimal fullGross = ZERO;          // un-pro-rated, drives ESI eligibility
        BigDecimal proratedBasic = ZERO;      // PF base
        for (EarningLine el : in.earnings()) {
            ComponentDef c = el.component();
            BigDecimal full = el.monthlyAmount().setScale(SCALE, RM);
            BigDecimal prorated = prorate(full, paidDays, totalDays);
            lines.add(new PayslipLine(c.code(), c.name(), c.category(), prorated, c.displayOrder()));
            if (isGross(c.category())) {
                gross = gross.add(prorated);
                fullGross = fullGross.add(full);
            }
            if ("BASIC".equals(c.code())) {
                proratedBasic = prorated;
            }
        }
        gross = gross.setScale(SCALE, RM);
        // ESI is charged on the structure's pro-rated gross; flat earnings
        // (incentives) are added to pay after that base is fixed.
        BigDecimal esiBase = gross;
        for (FlatLine fl : ex.flatEarnings()) {
            if (fl.amount() == null || fl.amount().signum() <= 0) continue;
            ComponentDef c = fl.component();
            BigDecimal amt = fl.amount().setScale(SCALE, RM);
            lines.add(new PayslipLine(c.code(), c.name(), c.category(), amt, c.displayOrder()));
            if (isGross(c.category())) gross = gross.add(amt);
        }
        gross = gross.setScale(SCALE, RM);

        StatutoryConfig st = in.statutory();
        EmployeeStructureCfg emp = in.employee();

        // ── 2. Provident Fund ────────────────────────────────────────────────
        if (st.pfEnabled() && emp.pfApplicable() && "ENROLLED".equals(emp.pfStatus())) {
            BigDecimal pfBase = proratedBasic;
            if (st.pfApplyCeiling() && st.pfWageCeiling() != null) {
                pfBase = pfBase.min(st.pfWageCeiling().setScale(SCALE, RM));  // FLAT ceiling
            }
            BigDecimal pfEmp = percent(pfBase, st.pfEmployeePercent());
            BigDecimal pfEr  = percent(pfBase, st.pfEmployerPercent());
            lines.add(new PayslipLine(PF_EMPLOYEE, "Provident Fund (Employee)", CAT_DEDUCTION, pfEmp, 50));
            lines.add(new PayslipLine(PF_EMPLOYER, "Provident Fund (Employer)", CAT_EMPLOYER, pfEr, 60));
        }

        // ── 3. ESI (eligibility on FULL gross, charge on PRO-RATED gross) ────
        if (st.esiEnabled() && emp.esiApplicable()) {
            BigDecimal ceiling = st.esiWageCeiling() == null ? ZERO : st.esiWageCeiling();
            if (fullGross.compareTo(ceiling) <= 0) {
                BigDecimal esiEmp = percent(esiBase, st.esiEmployeePercent());
                BigDecimal esiEr  = percent(esiBase, st.esiEmployerPercent());
                lines.add(new PayslipLine(ESI_EMPLOYEE, "ESI (Employee)", CAT_DEDUCTION, esiEmp, 70));
                lines.add(new PayslipLine(ESI_EMPLOYER, "ESI (Employer)", CAT_EMPLOYER, esiEr, 80));
            } else {
                warnings.add("ESI_SKIPPED: monthly gross " + fullGross.toPlainString()
                    + " exceeds ESI ceiling " + ceiling.toPlainString());
            }
        }

        // ── 4. Professional Tax (flat slab amount, never pro-rated) ──────────
        if (st.ptEnabled() && st.ptAmount() != null && st.ptAmount().signum() > 0) {
            lines.add(new PayslipLine(PT, "Professional Tax", CAT_DEDUCTION,
                st.ptAmount().setScale(SCALE, RM), 90));
        }

        // ── 4b. Labour Welfare Fund (flat, only in the months it's due) ──────
        // LWF and fixed deductions come out of wages paid: someone with no pay
        // for the period (a whole month unpaid, or joining after it) owes
        // neither, and must not end up with negative net pay (which halts the
        // whole run).
        boolean paidThisPeriod = gross.signum() > 0;
        if (paidThisPeriod && ex.lwfEmployee() != null && ex.lwfEmployee().signum() > 0) {
            lines.add(new PayslipLine(LWF_EMPLOYEE, "Labour Welfare Fund (Employee)", CAT_DEDUCTION,
                ex.lwfEmployee().setScale(SCALE, RM), 95));
        }
        if (paidThisPeriod && ex.lwfEmployer() != null && ex.lwfEmployer().signum() > 0) {
            lines.add(new PayslipLine(LWF_EMPLOYER, "Labour Welfare Fund (Employer)", CAT_EMPLOYER,
                ex.lwfEmployer().setScale(SCALE, RM), 96));
        }

        // ── 4c. Fixed-amount deductions (flat, never pro-rated) ──────────────
        for (FlatLine fl : ex.flatDeductions()) {
            if (!paidThisPeriod || fl.amount() == null || fl.amount().signum() <= 0) continue;
            ComponentDef c = fl.component();
            lines.add(new PayslipLine(c.code(), c.name(), CAT_DEDUCTION, fl.amount().setScale(SCALE, RM), c.displayOrder()));
        }

        // ── 5. Totals ────────────────────────────────────────────────────────
        BigDecimal totalDeductions = ZERO;
        BigDecimal totalEmployer = ZERO;
        for (PayslipLine l : lines) {
            if (CAT_DEDUCTION.equals(l.category())) {
                totalDeductions = totalDeductions.add(l.amount());
            } else if (CAT_EMPLOYER.equals(l.category())) {
                totalEmployer = totalEmployer.add(l.amount());
            }
        }
        totalDeductions = totalDeductions.setScale(SCALE, RM);
        totalEmployer = totalEmployer.setScale(SCALE, RM);
        BigDecimal net = gross.subtract(totalDeductions).setScale(SCALE, RM);

        // ── 6. Negative net is allowed, only flagged ─────────────────────────
        if (net.signum() < 0) {
            warnings.add("NEGATIVE_NET: deductions " + totalDeductions.toPlainString()
                + " exceed gross " + gross.toPlainString() + " (net " + net.toPlainString() + ")");
        }

        return new PayrollResult(gross, totalDeductions, totalEmployer, net,
            List.copyOf(lines), List.copyOf(warnings));
    }

    private static boolean isGross(String category) {
        return CAT_EARNING.equals(category) || CAT_REIMBURSEMENT.equals(category);
    }

    /** amount * paidDays / totalDays, HALF_UP 2dp. */
    private static BigDecimal prorate(BigDecimal amount, BigDecimal paidDays, BigDecimal totalDays) {
        if (totalDays.signum() == 0) return ZERO;
        return amount.multiply(paidDays).divide(totalDays, SCALE, RM);
    }

    /** base * percent / 100, HALF_UP 2dp. */
    private static BigDecimal percent(BigDecimal base, BigDecimal pct) {
        if (pct == null) return ZERO;
        return base.multiply(pct).divide(HUNDRED, SCALE, RM);
    }
}
