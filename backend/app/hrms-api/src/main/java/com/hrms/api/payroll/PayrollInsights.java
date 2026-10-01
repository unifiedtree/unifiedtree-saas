package com.hrms.api.payroll;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.Month;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * The rules behind the redesign's payroll read models (BW-50 to BW-57), kept
 * free of the database so they can be tested on their own. Nothing here
 * changes how pay is calculated: every figure comes from payslip lines a run
 * has already written.
 */
public final class PayrollInsights {

    private PayrollInsights() {}

    /** A run's pay changed "a lot" for a person when their net pay moved by more than this. */
    public static final BigDecimal VARIANCE_PERCENT = new BigDecimal("10");

    /** Bank IFSC shape, the same test the bank file uses (DisbursementBatchService). */
    private static final Pattern IFSC = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");

    // ── Check keys (BW-51) ─────────────────────────────────────────────────────
    public static final String VARIANCE = "VARIANCE";
    public static final String MISSING_BANK = "MISSING_BANK";
    public static final String PRORATED_JOINERS = "PRORATED_JOINERS";
    public static final String FNF_IN_PROGRESS = "FNF_IN_PROGRESS";
    public static final String SKIPPED = "SKIPPED";
    public static final String LOP = "LOP";

    /** The checks that put a person in "Needs review". The others are for information. */
    public static final Set<String> REVIEW_KEYS = Set.of(VARIANCE, MISSING_BANK, FNF_IN_PROGRESS);

    public static final String INFO = "INFO";
    public static final String WARNING = "WARNING";
    public static final String CRITICAL = "CRITICAL";

    /** One "Checks before you lock" row. */
    public record Check(String key, String severity, int count, String text, boolean needsReview,
                        List<UUID> employeeIds) {}

    /** What the checks need to know about one person in a run. */
    public record Person(UUID employeeId, String name, BigDecimal netPay, BigDecimal changePercent,
                         boolean hasBankAccount, boolean fnfInProgress, LocalDate dateOfJoining,
                         BigDecimal lopDays) {}

    // ── Per person ─────────────────────────────────────────────────────────────

    /**
     * Net (or gross) pay change against the previous period in percent, one
     * decimal; null when there is no previous figure or it was zero.
     */
    public static BigDecimal changePercent(BigDecimal now, BigDecimal previous) {
        if (now == null || previous == null || previous.signum() == 0) return null;
        return now.subtract(previous).multiply(new BigDecimal("100"))
                .divide(previous.abs(), 1, RoundingMode.HALF_UP);
    }

    /** Joined inside the run's pay period. */
    public static boolean newJoiner(LocalDate joined, LocalDate periodStart, LocalDate periodEnd) {
        return joined != null && periodStart != null && periodEnd != null
                && !joined.isBefore(periodStart) && !joined.isAfter(periodEnd);
    }

    /** Joined after the first day of the pay period, so the month is paid pro rata. */
    public static boolean prorated(LocalDate joined, LocalDate periodStart, LocalDate periodEnd) {
        return joined != null && periodStart != null && periodEnd != null
                && joined.isAfter(periodStart) && !joined.isAfter(periodEnd);
    }

    /**
     * A usable bank account for the bank file: a primary account with an IFSC
     * of the right shape (what DisbursementBatchService.buildFromRun checks).
     */
    public static boolean bankUsable(boolean hasPrimaryAccount, String ifsc) {
        return hasPrimaryAccount && ifsc != null && IFSC.matcher(ifsc).matches();
    }

    /** What the bank file would say about this person: null when ready. */
    public static String bankProblem(boolean hasPrimaryAccount, String ifsc) {
        if (!hasPrimaryAccount) return "No primary bank account on file";
        if (ifsc == null || !IFSC.matcher(ifsc).matches()) return "Invalid IFSC: " + (ifsc == null ? "" : ifsc);
        return null;
    }

    /** The bank file's line status for this person (READY, SKIPPED_MISSING_DETAILS, SKIPPED_INVALID_IFSC). */
    public static String bankStatus(boolean hasPrimaryAccount, String ifsc) {
        if (!hasPrimaryAccount) return "SKIPPED_MISSING_DETAILS";
        if (ifsc == null || !IFSC.matcher(ifsc).matches()) return "SKIPPED_INVALID_IFSC";
        return "READY";
    }

    public static boolean bigChange(BigDecimal changePercent) {
        return changePercent != null && changePercent.abs().compareTo(VARIANCE_PERCENT) > 0;
    }

    /** The "Needs review" reasons for one person, in check order. */
    public static List<String> reviewReasons(BigDecimal changePercent, boolean hasBankAccount, boolean fnfInProgress) {
        List<String> out = new ArrayList<>(3);
        if (bigChange(changePercent)) out.add(VARIANCE);
        if (!hasBankAccount) out.add(MISSING_BANK);
        if (fnfInProgress) out.add(FNF_IN_PROGRESS);
        return out;
    }

    // ── Checks before you lock (BW-51) ─────────────────────────────────────────

    /**
     * The run's checks with at least one person, in a fixed order. Only people
     * with pay to send count for missing bank details, as in the bank file.
     *
     * @param previousPeriod the month the changes are compared with ("Aug 2026"); null when none
     */
    public static List<Check> checks(List<Person> people, List<UUID> skippedIds, LocalDate periodStart,
                                     LocalDate periodEnd, String previousPeriod) {
        List<Check> out = new ArrayList<>();
        List<Person> changed = filter(people, p -> bigChange(p.changePercent()));
        if (!changed.isEmpty()) {
            int n = changed.size();
            out.add(new Check(VARIANCE, WARNING, n,
                    people(n, "employee") + " changed more than 10% from "
                            + (previousPeriod == null ? "the previous month" : previousPeriod),
                    true, ids(changed)));
        }
        List<Person> noBank = filter(people, p -> !p.hasBankAccount() && p.netPay() != null && p.netPay().signum() > 0);
        if (!noBank.isEmpty()) {
            int n = noBank.size();
            out.add(new Check(MISSING_BANK, CRITICAL, n,
                    people(n, "employee") + (n == 1 ? " is" : " are") + " missing bank details",
                    true, ids(noBank)));
        }
        List<Person> joiners = filter(people, p -> prorated(p.dateOfJoining(), periodStart, periodEnd));
        if (!joiners.isEmpty()) {
            int n = joiners.size();
            String text = n == 1
                    ? "1 new joiner is prorated from " + day(joiners.get(0).dateOfJoining())
                    : n + " new joiners are prorated";
            out.add(new Check(PRORATED_JOINERS, INFO, n, text, false, ids(joiners)));
        }
        List<Person> fnf = filter(people, Person::fnfInProgress);
        if (!fnf.isEmpty()) {
            int n = fnf.size();
            String text = n == 1
                    ? "Full & final for " + fnf.get(0).name() + " is in progress"
                    : "Full & final is in progress for " + n + " employees";
            out.add(new Check(FNF_IN_PROGRESS, WARNING, n, text, true, ids(fnf)));
        }
        if (skippedIds != null && !skippedIds.isEmpty()) {
            int n = skippedIds.size();
            out.add(new Check(SKIPPED, WARNING, n,
                    people(n, "employee") + (n == 1 ? " was" : " were") + " left out: no salary structure",
                    false, List.copyOf(skippedIds)));
        }
        List<Person> lop = filter(people, p -> p.lopDays() != null && p.lopDays().signum() > 0);
        if (!lop.isEmpty()) {
            int n = lop.size();
            out.add(new Check(LOP, INFO, n,
                    people(n, "employee") + (n == 1 ? " has" : " have") + " loss of pay this month",
                    false, ids(lop)));
        }
        return out;
    }

    // ── Statutory dues from one run (BW-52) ────────────────────────────────────

    /** One scheme's amount from a run, with its due date where the law gives one date everywhere. */
    public record Due(String scheme, String label, BigDecimal employeeShare, BigDecimal employerShare,
                      BigDecimal total, String dueDate) {}

    /**
     * PF and ESI are due on the 15th of the next month, TDS on the 7th. PT and
     * LWF depend on the state, so no date is given. TDS appears only when the
     * run has a TDS line (payroll does not calculate income tax).
     *
     * @param amounts component code → amount summed over the run
     */
    public static List<Due> statutoryDues(java.util.Map<String, BigDecimal> amounts, int periodYear, int periodMonth) {
        YearMonth next = YearMonth.of(periodYear, periodMonth).plusMonths(1);
        String on15 = next.atDay(15).toString();
        String on7 = next.atDay(7).toString();
        List<Due> out = new ArrayList<>();
        add(out, "PF", "Provident fund", amounts, "PF_EMPLOYEE", "PF_EMPLOYER", on15);
        add(out, "ESI", "ESI", amounts, "ESI_EMPLOYEE", "ESI_EMPLOYER", on15);
        add(out, "PT", "Professional tax", amounts, "PT", null, null);
        add(out, "LWF", "Labour welfare fund", amounts, "LWF_EMPLOYEE", "LWF_EMPLOYER", null);
        add(out, "TDS", "TDS", amounts, "TDS", null, on7);
        return out;
    }

    private static void add(List<Due> out, String scheme, String label, java.util.Map<String, BigDecimal> amounts,
                            String employeeCode, String employerCode, String dueDate) {
        BigDecimal ee = amounts.getOrDefault(employeeCode, BigDecimal.ZERO);
        BigDecimal er = employerCode == null ? BigDecimal.ZERO : amounts.getOrDefault(employerCode, BigDecimal.ZERO);
        if (ee == null) ee = BigDecimal.ZERO;
        if (er == null) er = BigDecimal.ZERO;
        BigDecimal total = ee.add(er);
        if (total.signum() <= 0) return;
        out.add(new Due(scheme, label, ee, er, total, dueDate));
    }

    // ── My payslips (BW-55) ────────────────────────────────────────────────────

    /** A per-month note on a payslip. Kinds: PLI, ADVANCE_RECOVERY, LEAVE_ENCASHMENT, NEW_SALARY. */
    public record Note(String kind, String label, BigDecimal amount, String date) {}

    public static List<Note> notes(BigDecimal pli, String pliLabel, BigDecimal advance, String advanceLabel,
                                   BigDecimal encashment, String encashmentLabel, LocalDate newSalaryFrom) {
        List<Note> out = new ArrayList<>(4);
        if (pli != null && pli.signum() > 0) out.add(new Note("PLI", nz(pliLabel, "Performance incentive"), pli, null));
        if (advance != null && advance.signum() > 0) out.add(new Note("ADVANCE_RECOVERY", nz(advanceLabel, "Advance recovery"), advance, null));
        if (encashment != null && encashment.signum() > 0) out.add(new Note("LEAVE_ENCASHMENT", nz(encashmentLabel, "Leave encashment"), encashment, null));
        if (newSalaryFrom != null) out.add(new Note("NEW_SALARY", "First month on the new salary", null, newSalaryFrom.toString()));
        return out;
    }

    /** The month a company's financial year starts in; April when unset or not a month name. */
    public static Month fiscalYearStart(String stored) {
        if (stored == null) return Month.APRIL;
        try {
            return Month.valueOf(stored.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Month.APRIL;
        }
    }

    /** The financial year that contains {@code day}: [first day, last day]. */
    public static LocalDate[] fiscalYear(LocalDate day, Month startMonth) {
        int year = day.getMonthValue() >= startMonth.getValue() ? day.getYear() : day.getYear() - 1;
        LocalDate start = LocalDate.of(year, startMonth, 1);
        return new LocalDate[]{start, start.plusYears(1).minusDays(1)};
    }

    /** "FY 2026–27", or "FY 2026" for a January year. */
    public static String fiscalYearLabel(LocalDate start) {
        if (start.getMonthValue() == 1) return "FY " + start.getYear();
        return "FY " + start.getYear() + "–" + String.format("%02d", (start.getYear() + 1) % 100);
    }

    /**
     * The next pay date from Payroll settings, for when no run carries one:
     * this cycle's processing day, or the next cycle's when it has passed or
     * that month already has a run (whose own pay date is then the one that
     * counts). One date: the processing day is the pay date today (AUDIT §5.9).
     *
     * @param periodsWithRun months ("2026-09") that already have a run for the company (cancelled ones left out)
     */
    public static LocalDate nextProcessingDate(LocalDate today, int cycleStartDay, int processingDay,
                                               Collection<String> periodsWithRun) {
        // The run named after the month its cycle ends in (PayrollCalc.cycleStart).
        YearMonth ym = YearMonth.from(today);
        if (!PayrollCalc.cyclePeriod(ym, cycleStartDay).end().isAfter(today.minusDays(1))) ym = ym.plusMonths(1);
        while (PayrollCalc.cyclePeriod(ym, cycleStartDay).start().isAfter(today)) ym = ym.minusMonths(1);
        for (int i = 0; i < 4; i++, ym = ym.plusMonths(1)) {
            LocalDate pay = PayrollCalc.payDate(PayrollCalc.cyclePeriod(ym, cycleStartDay).end(), processingDay);
            if (pay.isBefore(today)) continue;
            if (periodsWithRun != null && periodsWithRun.contains(ym.toString())) continue;
            return pay;
        }
        return null;
    }

    public static String periodLabel(int month, int year) {
        return Month.of(month).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + year;
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    private static List<Person> filter(List<Person> people, Predicate<Person> test) {
        List<Person> out = new ArrayList<>();
        if (people != null) for (Person p : people) if (test.test(p)) out.add(p);
        return out;
    }

    private static List<UUID> ids(List<Person> people) {
        return people.stream().map(Person::employeeId).toList();
    }

    private static String people(int n, String noun) {
        return n + " " + noun + (n == 1 ? "" : "s");
    }

    private static String day(LocalDate d) {
        return d.getDayOfMonth() + " " + d.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }

    private static String nz(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s;
    }
}
