package com.unifiedtree.saas.admin.billing;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Invoice numbering and money rounding. */
class InvoiceServiceTest {

    @Test
    void financialYearRunsAprilToMarchInIndianTime() {
        // 31 Mar 2026 23:00 IST is still FY 2025-26.
        assertThat(InvoiceService.financialYear(Instant.parse("2026-03-31T17:30:00Z"))).isEqualTo("25-26");
        // 1 Apr 2026 00:30 IST (31 Mar 19:00 UTC) is already FY 2026-27: the boundary is IST, not UTC.
        assertThat(InvoiceService.financialYear(Instant.parse("2026-03-31T19:00:00Z"))).isEqualTo("26-27");
        assertThat(InvoiceService.financialYear(Instant.parse("2026-10-06T12:00:00Z"))).isEqualTo("26-27");
        assertThat(InvoiceService.financialYear(Instant.parse("2099-12-31T12:00:00Z"))).isEqualTo("99-00");
    }

    @Test
    void moneyRoundsHalfUpToPaise() {
        assertThat(InvoiceService.money(new BigDecimal("10.005"))).isEqualByComparingTo("10.01");
        assertThat(InvoiceService.money(new BigDecimal("10.004"))).isEqualByComparingTo("10.00");
        assertThat(InvoiceService.money(new BigDecimal("49"))).isEqualByComparingTo("49.00");
    }

    @Test
    void aMissingAmountIsABadRequestNotANullPointer() {
        assertThatThrownBy(() -> InvoiceService.money(null)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void invoiceNumbersStayWithinGstsSixteenCharacters() {
        assertThat(InvoiceService.invoiceNumber("UT/26-27", 1)).isEqualTo("UT/26-27/00001");
        assertThat(InvoiceService.invoiceNumber("ABCD/26-27", 99999)).hasSize(16);
        assertThatThrownBy(() -> InvoiceService.invoiceNumber("ABCD/26-27", 100000))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void aGstInclusiveAmountSplitsBackToExactlyWhatWasPaid() {
        for (String gross : new String[] {"49.00", "1180.00", "99.99", "1.00", "4900.00", "0.01"}) {
            BigDecimal[] split = InvoiceService.splitInclusive(new BigDecimal(gross), new BigDecimal("18.00"));
            assertThat(split[0].add(split[1])).as(gross).isEqualByComparingTo(gross);
            assertThat(split[1].signum()).as(gross).isGreaterThanOrEqualTo(0);
        }
        BigDecimal[] fortyNine = InvoiceService.splitInclusive(new BigDecimal("49.00"), new BigDecimal("18.00"));
        assertThat(fortyNine[0]).isEqualByComparingTo("41.53");
        assertThat(fortyNine[1]).isEqualByComparingTo("7.47");
    }
}
