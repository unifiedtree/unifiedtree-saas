package com.unifiedtree.saas.billing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Extra users for a billing cycle (owner, 7 Oct 2026): the highest number of active employees on
 * any day of the cycle, minus the seats bought, never below 0; each costs the full-month per-user
 * price. Which companies they came from: the extras are shared across the companies in proportion
 * to their people on the peak day (whole users, largest remainder first, so the parts add up).
 * Pure arithmetic — no database — so it can be tested on its own.
 */
public final class ExtraUsers {

    private ExtraUsers() {}

    /** One company's active employees on one day. */
    public record DayCount(LocalDate day, UUID companyId, String companyName, int active) {}

    public record CompanyShare(UUID companyId, String name, int active, int extra) {}

    public record Result(int seatsBought, int peakActive, LocalDate peakDay, int extraUsers,
                         BigDecimal unitPriceInr, BigDecimal amountInr, List<CompanyShare> byCompany) {}

    public static Result compute(int seatsBought, BigDecimal unitPriceInr, List<DayCount> counts) {
        Map<LocalDate, List<DayCount>> byDay = new LinkedHashMap<>();
        for (DayCount c : counts) byDay.computeIfAbsent(c.day(), d -> new ArrayList<>()).add(c);

        LocalDate peakDay = null;
        int peak = 0;
        for (Map.Entry<LocalDate, List<DayCount>> e : byDay.entrySet()) {
            int total = e.getValue().stream().mapToInt(DayCount::active).sum();
            // The highest day; on a tie, the later day (closest to the charge).
            if (total > peak || (total == peak && peakDay != null && e.getKey().isAfter(peakDay)) || peakDay == null) {
                peak = total;
                peakDay = e.getKey();
            }
        }
        int extra = Math.max(0, peak - Math.max(0, seatsBought));
        BigDecimal unit = unitPriceInr == null ? BigDecimal.ZERO : unitPriceInr.setScale(2, RoundingMode.HALF_UP);
        BigDecimal amount = unit.multiply(BigDecimal.valueOf(extra)).setScale(2, RoundingMode.HALF_UP);

        List<CompanyShare> shares = new ArrayList<>();
        if (peakDay != null) {
            List<DayCount> day = byDay.get(peakDay);
            int total = day.stream().mapToInt(DayCount::active).sum();
            int given = 0;
            List<double[]> remainders = new ArrayList<>();   // [index, remainder]
            for (int i = 0; i < day.size(); i++) {
                DayCount c = day.get(i);
                double exact = total == 0 ? 0 : (double) extra * c.active() / total;
                int whole = (int) Math.floor(exact);
                given += whole;
                shares.add(new CompanyShare(c.companyId(), c.companyName(), c.active(), whole));
                remainders.add(new double[]{i, exact - whole});
            }
            remainders.sort(Comparator.comparingDouble((double[] r) -> -r[1]).thenComparingDouble(r -> r[0]));
            for (int k = 0; k < extra - given && k < remainders.size(); k++) {
                int i = (int) remainders.get(k)[0];
                CompanyShare s = shares.get(i);
                shares.set(i, new CompanyShare(s.companyId(), s.name(), s.active(), s.extra() + 1));
            }
        }
        return new Result(seatsBought, peak, peakDay, extra, unit, amount, shares);
    }
}
