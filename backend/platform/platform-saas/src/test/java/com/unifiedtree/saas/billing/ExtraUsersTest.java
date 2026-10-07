package com.unifiedtree.saas.billing;

import com.unifiedtree.saas.billing.ExtraUsers.CompanyShare;
import com.unifiedtree.saas.billing.ExtraUsers.DayCount;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Owner, 7 Oct 2026: extras = highest active employees on any day of the cycle − seats bought (≥ 0). */
class ExtraUsersTest {

    private static final UUID LABS = UUID.randomUUID();
    private static final UUID RETAIL = UUID.randomUUID();
    private static final LocalDate D1 = LocalDate.of(2026, 10, 7);

    private static DayCount labs(int day, int n) { return new DayCount(D1.plusDays(day), LABS, "Acme Labs", n); }
    private static DayCount retail(int day, int n) { return new DayCount(D1.plusDays(day), RETAIL, "Acme Retail", n); }

    @Test
    void theHighestDayCountsNotTheLastOne() {
        // 10 seats; the cycle peaks at 13 on day 5, then drops back to 10.
        var r = ExtraUsers.compute(10, new BigDecimal("400"), List.of(
                labs(0, 7), retail(0, 3),
                labs(5, 9), retail(5, 4),
                labs(20, 7), retail(20, 3)));
        assertThat(r.peakActive()).isEqualTo(13);
        assertThat(r.peakDay()).isEqualTo(D1.plusDays(5));
        assertThat(r.extraUsers()).isEqualTo(3);
        assertThat(r.amountInr()).isEqualByComparingTo("1200");   // full-month price each
    }

    @Test
    void neverBelowZero() {
        var r = ExtraUsers.compute(10, new BigDecimal("400"), List.of(labs(0, 4), retail(0, 2)));
        assertThat(r.extraUsers()).isZero();
        assertThat(r.amountInr()).isEqualByComparingTo("0");
    }

    @Test
    void theExtrasAreSharedByCompanyAndAddUp() {
        // Peak 15 (Labs 10, Retail 5), 10 seats: 5 extras -> Labs 3.33, Retail 1.67 -> 3 + 2.
        var r = ExtraUsers.compute(10, new BigDecimal("400"), List.of(labs(2, 10), retail(2, 5)));
        assertThat(r.byCompany()).extracting(CompanyShare::name, CompanyShare::active, CompanyShare::extra)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple("Acme Labs", 10, 3),
                        org.assertj.core.groups.Tuple.tuple("Acme Retail", 5, 2));
        assertThat(r.byCompany().stream().mapToInt(CompanyShare::extra).sum()).isEqualTo(r.extraUsers());
    }

    @Test
    void noReadingsMeansNothingExtra() {
        var r = ExtraUsers.compute(10, new BigDecimal("400"), List.of());
        assertThat(r.extraUsers()).isZero();
        assertThat(r.peakDay()).isNull();
        assertThat(r.byCompany()).isEmpty();
    }
}
