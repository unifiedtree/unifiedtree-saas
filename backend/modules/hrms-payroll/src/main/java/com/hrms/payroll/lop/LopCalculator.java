package com.hrms.payroll.lop;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure Loss-of-Pay calculator (Prompt 12). NO database, NO Spring — only
 * java.time / java.math. Encodes the rules documented in
 * {@code docs/PAYROLL-LOP-RULES.md}. The payroll engine (Prompt 13) will feed
 * it day statuses derived from attendance + leave; this class only does the math.
 *
 * <p>Invariant: {@code paidDays + lopDays == totalCalendar} always.
 */
public final class LopCalculator {

    public enum DayStatus {
        PRESENT, PAID_LEAVE, LOP_LEAVE, HOLIDAY, WEEKEND, UNAUTHORIZED_ABSENT, HALF_DAY_LEAVE
    }

    /** What a single calendar day resolves to after all rules. */
    public record DayBreakdown(int dayOfMonth, DayStatus status, String resolution, BigDecimal paid, BigDecimal lop) {}

    public record LopInput(
        List<DayStatus> days,
        boolean sandwichRuleEnabled,
        int lateMarkLopThreshold,   // 0 = disabled
        int lateMarkCount,
        LocalDate joinDate,         // nullable
        LocalDate exitDate,         // nullable
        YearMonth period
    ) {}

    public record LopResult(BigDecimal paidDays, BigDecimal lopDays, int totalCalendar, List<DayBreakdown> log) {}

    private static final BigDecimal ONE  = BigDecimal.ONE;
    private static final BigDecimal HALF = new BigDecimal("0.5");
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private LopCalculator() {}

    public static LopResult calculate(LopInput in) {
        int total = in.days().size();

        // Resolution per day: "PAID", "LOP", or "HALF".
        String[] resolution = new String[total];
        for (int i = 0; i < total; i++) {
            int dayOfMonth = i + 1;
            LocalDate date = in.period().atDay(dayOfMonth);
            DayStatus st = in.days().get(i);

            boolean preJoin  = in.joinDate() != null && date.isBefore(in.joinDate());
            boolean postExit = in.exitDate() != null && date.isAfter(in.exitDate());

            if (preJoin || postExit) {
                resolution[i] = "LOP";               // not employed that day
            } else {
                resolution[i] = switch (st) {
                    case PRESENT, PAID_LEAVE, HOLIDAY, WEEKEND -> "PAID";
                    case LOP_LEAVE, UNAUTHORIZED_ABSENT        -> "LOP";
                    case HALF_DAY_LEAVE                        -> "HALF";
                };
            }
        }

        // Sandwich rule: a maximal run of WEEKEND/HOLIDAY days that is bracketed by
        // an LOP day on BOTH adjacent (non-run) sides converts entirely to LOP.
        if (in.sandwichRuleEnabled()) {
            int i = 0;
            while (i < total) {
                DayStatus st = in.days().get(i);
                boolean isBridge = (st == DayStatus.WEEKEND || st == DayStatus.HOLIDAY) && "PAID".equals(resolution[i]);
                if (!isBridge) { i++; continue; }
                int runStart = i;
                while (i < total) {
                    DayStatus s2 = in.days().get(i);
                    boolean bridge = (s2 == DayStatus.WEEKEND || s2 == DayStatus.HOLIDAY) && "PAID".equals(resolution[i]);
                    if (!bridge) break;
                    i++;
                }
                int runEnd = i - 1;
                boolean leftLop  = runStart - 1 >= 0    && "LOP".equals(resolution[runStart - 1]);
                boolean rightLop = runEnd + 1 < total   && "LOP".equals(resolution[runEnd + 1]);
                if (leftLop && rightLop) {
                    for (int k = runStart; k <= runEnd; k++) resolution[k] = "LOP";
                }
            }
        }

        BigDecimal paid = ZERO;
        BigDecimal lop  = ZERO;
        List<DayBreakdown> log = new ArrayList<>(total);
        for (int i = 0; i < total; i++) {
            BigDecimal p, l;
            switch (resolution[i]) {
                case "PAID" -> { p = ONE;  l = ZERO; }
                case "LOP"  -> { p = ZERO; l = ONE;  }
                default     -> { p = HALF; l = HALF; }   // HALF
            }
            paid = paid.add(p);
            lop  = lop.add(l);
            log.add(new DayBreakdown(i + 1, in.days().get(i), resolution[i], p, l));
        }

        // Late-mark accrual: every `threshold` late marks = 1 LOP day, moved from paid.
        if (in.lateMarkLopThreshold() > 0 && in.lateMarkCount() > 0) {
            int lateLop = in.lateMarkCount() / in.lateMarkLopThreshold();
            BigDecimal move = new BigDecimal(Math.min(lateLop, paid.intValue()));
            paid = paid.subtract(move);
            lop  = lop.add(move);
        }

        return new LopResult(scale(paid), scale(lop), total, log);
    }

    private static BigDecimal scale(BigDecimal b) {
        return b.setScale(1, java.math.RoundingMode.HALF_UP);
    }
}
