package com.unifiedtree.saas.billing;

import com.unifiedtree.saas.billing.BillingBreakdownService.Breakdown;
import com.unifiedtree.saas.billing.BillingBreakdownService.Business;
import com.unifiedtree.saas.billing.BillingBreakdownService.CompanyLine;
import com.unifiedtree.saas.billing.BillingBreakdownService.CompanyRow;
import com.unifiedtree.saas.billing.BillingBreakdownService.Cycle;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Billing by company (owner decision 6 Oct, option a): one subscription, the amount split by company. */
class BillingBreakdownTest {

    private static final Business ACME = new Business("Acme Group", "29ABCDE1234F1Z5", "ABCDE1234F", "Bengaluru");

    private static CompanyRow co(String name, String gstin, int employees, boolean active) {
        return new CompanyRow(UUID.randomUUID(), name, name + " Pvt Ltd", gstin, null, active, "Bengaluru", employees);
    }

    private static Cycle monthly(int seats, String amount) {
        return new Cycle(seats, new BigDecimal(amount), "MONTHLY", "ACTIVE", Instant.parse("2026-10-06T00:00:00Z"),
                Instant.parse("2026-11-06T00:00:00Z"), null);
    }

    private static BigDecimal sum(Breakdown b) {
        BigDecimal s = b.companies().stream().map(CompanyLine::amountInr).reduce(BigDecimal.ZERO, BigDecimal::add);
        return b.unusedSeatsAmountInr() == null ? s : s.add(b.unusedSeatsAmountInr());
    }

    @Test
    void eachCompanyPaysForItsPeopleAndUnusedSeatsAreTheirOwnLine() {
        Breakdown b = BillingBreakdownService.split(ACME, monthly(10, "4000.00"),
                List.of(co("Acme Labs", "29AAAAA0000A1Z5", 6, true), co("Acme Retail", "27BBBBB1111B1Z5", 3, true)));

        assertThat(b.pricePerSeatInr()).isEqualByComparingTo("400");
        assertThat(b.companies()).extracting(CompanyLine::name).containsExactly("Acme Labs", "Acme Retail");
        assertThat(b.companies()).extracting(CompanyLine::gstin).containsExactly("29AAAAA0000A1Z5", "27BBBBB1111B1Z5");
        assertThat(b.companies().get(0).amountInr()).isEqualByComparingTo("2400");
        assertThat(b.companies().get(1).amountInr()).isEqualByComparingTo("1200");
        assertThat(b.unusedSeats()).isEqualTo(1);
        assertThat(b.unusedSeatsAmountInr()).isEqualByComparingTo("400");
        assertThat(sum(b)).isEqualByComparingTo(b.amountInr());
        assertThat(b.extraUsers()).isZero();
    }

    @Test
    void overTheSeatsTheAmountIsSharedAndTheExtrasAreBilledAtCycleEnd() {
        Breakdown b = BillingBreakdownService.split(ACME, monthly(10, "4000.00"),
                List.of(co("Acme Labs", null, 8, true), co("Acme Retail", null, 4, true)));

        assertThat(b.seatsUsed()).isEqualTo(12);
        assertThat(b.unusedSeats()).isZero();
        assertThat(b.extraUsers()).isEqualTo(2);
        assertThat(b.extraUsersAmountInr()).isEqualByComparingTo("800");
        assertThat(sum(b)).isEqualByComparingTo("4000");   // the cycle's amount, extras come later
    }

    @Test
    void roundingNeverLeavesTheTotalOffByAPaisa() {
        // 3 seats for ₹1,000 = ₹333.333… a seat.
        Breakdown b = BillingBreakdownService.split(ACME, monthly(3, "1000.00"),
                List.of(co("A", null, 1, true), co("B", null, 1, true), co("C", null, 1, true)));
        assertThat(sum(b)).isEqualByComparingTo("1000.00");
    }

    @Test
    void anArchivedCompanyWithNobodyIsLeftOutButOneWithPeopleStays() {
        Breakdown b = BillingBreakdownService.split(ACME, monthly(5, "2000"),
                List.of(co("Live", null, 2, true), co("Closed", null, 0, false), co("Closing", null, 1, false)));
        assertThat(b.companies()).extracting(CompanyLine::name).containsExactly("Live", "Closing");
    }

    @Test
    void withoutAPaidSubscriptionPeopleAreListedWithoutAmounts() {
        Breakdown b = BillingBreakdownService.split(ACME, null, List.of(co("Acme Labs", null, 4, true)));
        assertThat(b.amountInr()).isNull();
        assertThat(b.companies().get(0).employees()).isEqualTo(4);
        assertThat(b.companies().get(0).amountInr()).isNull();
        assertThat(b.note()).contains("autopay");
    }
}
