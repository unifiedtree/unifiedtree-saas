package com.hrms.api.payroll;

import com.hrms.payroll.engine.PayrollEngine.ComponentDef;
import com.hrms.payroll.engine.PayrollEngine.EarningLine;
import com.hrms.payroll.engine.PayrollEngine.FlatLine;
import com.hrms.payroll.lop.LopCalculator.DayStatus;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;

/**
 * The pure rules payroll applies around the engine (V143.11, 25 Sep 2026). No
 * database and no Spring, so every rule is unit-tested on its own
 * ({@code PayrollCalcTest}):
 * <ul>
 *   <li>whose weekly off days count, and which days are working days;</li>
 *   <li>the pay period of a run on a custom cycle, and its pay date;</li>
 *   <li>which months deduct the Labour Welfare Fund;</li>
 *   <li>fixed-amount components and switched-off components;</li>
 *   <li>folding components hidden from payslips into one "Other" line.</li>
 * </ul>
 */
public final class PayrollCalc {

    private PayrollCalc() {}

    /** ISO day numbers (1 = Monday … 7 = Sunday). */
    public static final Set<Integer> SAT_SUN = Set.of(DayOfWeek.SATURDAY.getValue(), DayOfWeek.SUNDAY.getValue());

    /**
     * Components payroll works out itself. They never take a fixed amount from
     * the component catalogue, whatever their computation type says.
     */
    public static final Set<String> PAYROLL_MANAGED = Set.of(
            "ADVANCE_RECOVERY", "PLI_INCENTIVE", "LEAVE_ENCASHMENT", "LWF_EMPLOYEE", "LWF_EMPLOYER",
            "PF_EMPLOYEE", "PF_EMPLOYER", "ESI_EMPLOYEE", "ESI_EMPLOYER", "PT");

    // ── Weekly offs and working days ───────────────────────────────────────────

    /** ISO day numbers from a CSV such as "6,7"; empty for null, blank or junk. */
    public static Set<Integer> parseOffDays(String csv) {
        Set<Integer> out = new TreeSet<>();
        if (csv == null || csv.isBlank()) return out;
        for (String tok : csv.split(",")) {
            try {
                int d = Integer.parseInt(tok.trim());
                if (d >= 1 && d <= 7) out.add(d);
            } catch (NumberFormatException ignored) { /* skip junk */ }
        }
        return out;
    }

    /** Valid ISO day numbers from the company's HR configuration array; empty when unset. */
    public static Set<Integer> companyOffDays(Integer[] days) {
        Set<Integer> out = new TreeSet<>();
        if (days == null) return out;
        for (Integer d : days) if (d != null && d >= 1 && d <= 7) out.add(d);
        return out;
    }

    /**
     * An employee's weekly off days, the way attendance and leave resolve them:
     * the employee's own {@code weekly_off_days} when set, else the company's
     * HR configuration {@code weekend_days}, else Saturday and Sunday.
     */
    public static Set<Integer> resolveOffDays(String employeeCsv, Set<Integer> companyDays) {
        Set<Integer> own = parseOffDays(employeeCsv);
        if (!own.isEmpty()) return own;
        if (companyDays != null && !companyDays.isEmpty()) return companyDays;
        return SAT_SUN;
    }

    /** Days in [start, end] that are neither a weekly off nor a holiday. */
    public static int workingDays(LocalDate start, LocalDate end, Set<Integer> offDays, Set<LocalDate> holidays) {
        int n = 0;
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            if (offDays.contains(d.getDayOfWeek().getValue())) continue;
            if (holidays != null && holidays.contains(d)) continue;
            n++;
        }
        return n;
    }

    /**
     * One status per day of the pay period, exception-based: approved leave
     * first, then the attendance record, then holiday, then the employee's
     * weekly off, and anything else counts as present (paid).
     */
    public static List<DayStatus> dayStatuses(LocalDate start, LocalDate end,
                                              Map<LocalDate, DayStatus> leave,
                                              Map<LocalDate, DayStatus> attendance,
                                              Set<LocalDate> holidays, Set<Integer> offDays) {
        List<DayStatus> days = new ArrayList<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            DayStatus s = leave == null ? null : leave.get(d);
            if (s == null && attendance != null) s = attendance.get(d);
            if (s == null && holidays != null && holidays.contains(d)) s = DayStatus.HOLIDAY;
            if (s == null && offDays.contains(d.getDayOfWeek().getValue())) s = DayStatus.WEEKEND;
            if (s == null) s = DayStatus.PRESENT;
            days.add(s);
        }
        return days;
    }

    // ── Attendance → pay (the effective day status, V143.10) ───────────────────

    /** How one attendance day enters payroll: its day status (null = no attendance input) and whether it is a late mark. */
    public record AttendancePay(DayStatus status, boolean lateMark) {}

    /**
     * The attendance record's stored status, as payroll read it before the
     * attendance policy existed: PRESENT / LATE / PENDING_REGULARIZATION paid,
     * ABSENT loss of pay, HALF_DAY half, HOLIDAY holiday; anything else (ON_TIME,
     * NOT_MARKED, WFH, ON_LEAVE, WEEKEND, no record) is null so leave, holidays,
     * weekly offs and the exception-based "present" decide.
     */
    public static DayStatus legacyAttendance(String recordStatus) {
        if (recordStatus == null) return null;
        return switch (recordStatus) {
            case "PRESENT", "LATE", "PENDING_REGULARIZATION" -> DayStatus.PRESENT;
            case "ABSENT" -> DayStatus.UNAUTHORIZED_ABSENT;
            case "HALF_DAY" -> DayStatus.HALF_DAY_LEAVE;
            case "HOLIDAY" -> DayStatus.HOLIDAY;
            default -> null;
        };
    }

    /**
     * One day's attendance input to payroll, from the stored record status and
     * the day's effective status (EffectiveDayStatusService: the company's
     * timing policy plus reviewers' changes). Conservative on purpose, so a
     * company that never set the policy is paid as before:
     * <ol>
     *   <li>No effective status (policy service not available): the stored status, as before.</li>
     *   <li>A reviewer's manual status wins.</li>
     *   <li>A status HR stored on the record itself (manual entry: ABSENT, HALF_DAY,
     *       HOLIDAY) is kept.</li>
     *   <li>A day without a punch keeps the old rule (no record = present), except a
     *       punch HR rejected ("not them"), which is an absence. Payroll does not turn
     *       "no punch" into an absence by itself.</li>
     *   <li>A day with a punch follows the policy: PRESENT as before; LATE = paid
     *       plus a late mark, or loss of pay when the policy says so (then no late
     *       mark too, it is already unpaid); HALF_DAY = half day; ABSENT (worked under
     *       the half-day minimum) = loss of pay.</li>
     * </ol>
     * Approved leave keeps precedence (dayStatuses reads leave first), and
     * holidays / weekly offs stay payroll's own rule.
     *
     * @param effStatus     EffectiveDay.status, null when unknown
     * @param manual        a reviewer set or excused the day
     * @param punched       the day has a check-in that wasn't rejected
     * @param punchRejected HR rejected the day's face punch-in
     * @param lossOfPay     a late arrival past the allowance counted as loss of pay
     */
    public static AttendancePay attendanceDay(String recordStatus, String effStatus, boolean manual,
                                              boolean punched, boolean punchRejected, boolean lossOfPay) {
        DayStatus legacy = legacyAttendance(recordStatus);
        AttendancePay asBefore = new AttendancePay(legacy, "LATE".equals(recordStatus));
        if (effStatus == null) return asBefore;
        if (!manual) {
            if ("ABSENT".equals(recordStatus) || "HALF_DAY".equals(recordStatus) || "HOLIDAY".equals(recordStatus)) {
                return new AttendancePay(legacy, false);
            }
            if (!punched) {
                if (punchRejected && "ABSENT".equals(effStatus)) return new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false);
                return asBefore;
            }
        }
        return switch (effStatus) {
            // Not late (on time, inside the allowance, or worked on a day off):
            // what the record said, without a late mark. A reviewer's "present"
            // is present.
            case "PRESENT" -> new AttendancePay(manual ? DayStatus.PRESENT : legacy, false);
            case "LATE" -> lossOfPay && !manual
                    ? new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false)
                    : new AttendancePay(DayStatus.PRESENT, true);
            case "HALF_DAY" -> new AttendancePay(DayStatus.HALF_DAY_LEAVE, false);
            case "ABSENT" -> new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false);
            default -> asBefore;
        };
    }

    // ── Pay period and pay date ────────────────────────────────────────────────

    /** A run's pay period, both ends included. */
    public record Period(LocalDate start, LocalDate end) {
        public int days() { return (int) (end.toEpochDay() - start.toEpochDay()) + 1; }
    }

    /**
     * The first day of the run named {@code ym} on a cycle that starts on
     * {@code startDay}. Day 1 is the calendar month. Any other day starts in
     * the previous month, so the September run on a 26th cycle covers
     * 26 Aug – 25 Sep (a run is named after the month its cycle ends in). A
     * start day past the end of a short month starts on that month's last day.
     */
    public static LocalDate cycleStart(YearMonth ym, int startDay) {
        int s = Math.max(1, Math.min(31, startDay));
        if (s == 1) return ym.atDay(1);
        YearMonth prev = ym.minusMonths(1);
        return prev.atDay(Math.min(s, prev.lengthOfMonth()));
    }

    /** The pay period of the run named {@code ym}: up to the day before the next run starts. */
    public static Period cyclePeriod(YearMonth ym, int startDay) {
        return new Period(cycleStart(ym, startDay), cycleStart(ym.plusMonths(1), startDay).minusDays(1));
    }

    /**
     * The planned pay date: the processing day in the month the period ends in,
     * or that month's last day when it is shorter.
     */
    public static LocalDate payDate(LocalDate periodEnd, int processingDay) {
        YearMonth m = YearMonth.from(periodEnd);
        return m.atDay(Math.max(1, Math.min(processingDay, m.lengthOfMonth())));
    }

    /** The cycle's end day as Payroll Settings shows it: the day before the start day. */
    public static int cycleEndDay(int startDay) {
        return startDay <= 1 ? 31 : startDay - 1;
    }

    // ── Labour Welfare Fund ────────────────────────────────────────────────────

    /** True when LWF is switched on and the run's month is one of the configured months. */
    public static boolean lwfDue(boolean enabled, Collection<Integer> months, int periodMonth) {
        return enabled && months != null && months.contains(periodMonth);
    }

    // ── Components ─────────────────────────────────────────────────────────────

    /** A salary component from the catalogue, as payroll needs it. */
    public record ComponentInfo(String code, String name, String category, boolean statutory,
                                int displayOrder, String computationType, BigDecimal amount,
                                boolean active, boolean showOnPayslip) {}

    /** One line of an employee's salary structure. */
    public record StructureLine(String code, String name, String category, boolean statutory,
                                int displayOrder, BigDecimal monthlyAmount) {}

    /** What the engine gets from the structure and the catalogue. */
    public record ResolvedPay(List<EarningLine> earnings, List<FlatLine> flatDeductions, boolean derivedFromCtc) {}

    /** True for a FIXED component that may carry a catalogue amount. */
    public static boolean takesFixedAmount(ComponentInfo c) {
        return c != null && "FIXED".equals(c.computationType()) && !c.statutory()
                && !PAYROLL_MANAGED.contains(c.code());
    }

    private static boolean isEarning(String category) {
        return "EARNING".equals(category) || "REIMBURSEMENT".equals(category);
    }

    private static boolean positive(BigDecimal v) { return v != null && v.signum() > 0; }

    /**
     * The pay lines for one employee:
     * <ol>
     *   <li>the structure's earnings, skipping components that are switched off;</li>
     *   <li>when the structure has no earnings at all, one BASIC line of the monthly CTC
     *       (as payroll always did);</li>
     *   <li>every active FIXED earning with a catalogue amount that the structure
     *       doesn't list, at that amount (pro-rated by the engine like other earnings);</li>
     *   <li>every active FIXED deduction: the structure's own amount when it lists the
     *       component, else the catalogue amount, taken in full.</li>
     * </ol>
     * A component missing from {@code catalog} is treated as active, so a
     * structure line is never dropped for want of catalogue data.
     */
    public static ResolvedPay resolvePay(List<StructureLine> structure, Map<String, ComponentInfo> catalog,
                                         BigDecimal ctcMonthly, ComponentDef basicFallback) {
        List<StructureLine> lines = structure == null ? List.of() : structure;
        Map<String, ComponentInfo> cat = catalog == null ? Map.of() : catalog;
        List<EarningLine> earnings = new ArrayList<>();
        List<FlatLine> flatDeductions = new ArrayList<>();
        Set<String> onStructure = new HashSet<>();
        boolean anyEarning = false;
        for (StructureLine l : lines) {
            onStructure.add(l.code());
            if (!isEarning(l.category())) continue;
            anyEarning = true;
            ComponentInfo ci = cat.get(l.code());
            if (ci != null && !ci.active()) continue;
            earnings.add(new EarningLine(new ComponentDef(l.code(), l.name(), l.category(), l.statutory(), l.displayOrder()),
                    l.monthlyAmount() == null ? BigDecimal.ZERO : l.monthlyAmount()));
        }
        boolean derived = !anyEarning;
        if (derived && basicFallback != null && ctcMonthly != null && ctcMonthly.signum() > 0) {
            earnings.add(new EarningLine(basicFallback, ctcMonthly));
        }
        List<ComponentInfo> fixed = new ArrayList<>(cat.values());
        fixed.sort(Comparator.comparingInt(ComponentInfo::displayOrder).thenComparing(ComponentInfo::code));
        for (ComponentInfo c : fixed) {
            if (!c.active() || !takesFixedAmount(c)) continue;
            if (isEarning(c.category())) {
                if (!onStructure.contains(c.code()) && positive(c.amount())) {
                    earnings.add(new EarningLine(new ComponentDef(c.code(), c.name(), c.category(), false, c.displayOrder()), c.amount()));
                }
            } else if ("DEDUCTION".equals(c.category())) {
                BigDecimal amt = c.amount();
                for (StructureLine l : lines) if (l.code().equals(c.code())) amt = l.monthlyAmount();
                if (positive(amt)) {
                    flatDeductions.add(new FlatLine(new ComponentDef(c.code(), c.name(), "DEDUCTION", false, c.displayOrder()), amt));
                }
            }
        }
        return new ResolvedPay(earnings, flatDeductions, derived);
    }

    // ── Payslip display ────────────────────────────────────────────────────────

    /** A payslip line with its component's "show on payslip" flag. */
    public record SlipLine(String code, String name, BigDecimal amount, boolean shown) {}

    /**
     * The lines as a payslip prints them: hidden components are added up into
     * one line named {@code otherName} (placed last), so the lines still add up
     * to the totals. Nothing is folded when every line is shown.
     */
    public static List<PayrollRunService.PayslipLineDto> foldHidden(List<SlipLine> lines, String otherCode, String otherName) {
        List<PayrollRunService.PayslipLineDto> out = new ArrayList<>();
        BigDecimal hidden = BigDecimal.ZERO;
        boolean anyHidden = false;
        for (SlipLine l : lines) {
            if (l.shown()) {
                out.add(new PayrollRunService.PayslipLineDto(l.code(), l.name(), l.amount()));
            } else {
                anyHidden = true;
                hidden = hidden.add(l.amount() == null ? BigDecimal.ZERO : l.amount());
            }
        }
        if (anyHidden) out.add(new PayrollRunService.PayslipLineDto(otherCode, otherName, hidden));
        return out;
    }
}
