package com.hrms.api.approvals;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The words on approval rows, recent decisions and the "decision undone" notification. */
class ApprovalTextTest {

    @Test void dateRanges() {
        LocalDate d = LocalDate.of(2026, 9, 28);
        assertEquals("28 Sep", DateText.shortRange(d, d));
        assertEquals("28–29 Sep", DateText.shortRange(d, d.plusDays(1)));
        assertEquals("28 Sep – 2 Oct", DateText.shortRange(d, LocalDate.of(2026, 10, 2)));
        assertEquals("30 Dec 2026 – 2 Jan 2027", DateText.shortRange(LocalDate.of(2026, 12, 30), LocalDate.of(2027, 1, 2)));
        assertEquals("for 28 Sep 2026", DateText.longRange(d, d));
        assertEquals("for 28 Sep 2026 to 29 Sep 2026", DateText.longRange(d, d.plusDays(1)));
        assertEquals("Sep 2026", DateText.month(2026, 9));
        assertEquals("09:30", DateText.time(Instant.parse("2026-09-28T04:00:00Z")));
    }

    @Test void amounts() {
        assertEquals("₹4,860", Money.format("INR", new BigDecimal("4860.00")));
        assertEquals("₹1,20,000.50", Money.format(null, new BigDecimal("120000.5")));
        assertEquals("USD 12.50", Money.format("usd", new BigDecimal("12.5")));
        assertEquals("₹12,34,567", Money.format("INR", new BigDecimal("1234567")));
        assertEquals("₹999", Money.format("INR", new BigDecimal("999")));
        assertEquals("USD 1,234,567", Money.format("USD", new BigDecimal("1234567")));
    }

    @Test void inboxWords() {
        assertEquals("1 day", InboxQueries.dayCount(1));
        assertEquals("0.5 days", InboxQueries.dayCount(0.5));
        assertEquals("4 days", InboxQueries.dayCount(4));
        assertEquals("Arjun", InboxQueries.names(List.of("Arjun")));
        assertEquals("Arjun and Mala", InboxQueries.names(List.of("Arjun", "Mala")));
        assertEquals("Arjun, Mala and Ravi", InboxQueries.names(List.of("Arjun", "Mala", "Ravi")));
        assertEquals("Arjun, Mala and 3 others", InboxQueries.names(List.of("Arjun", "Mala", "Ravi", "Sita", "Anil")));
        Instant in = Instant.parse("2026-09-23T04:01:00Z");
        assertEquals("Missed punch-in", InboxQueries.correctionTitle(in, null, null));
        assertEquals("Missed punch-out", InboxQueries.correctionTitle(null, in, in));
        assertEquals("Time fix", InboxQueries.correctionTitle(in, in.plusSeconds(3600), in));
        assertEquals("Missed punches", InboxQueries.correctionTitle(in, in.plusSeconds(3600), null));
        assertEquals("In 09:31 · Out 19:05", InboxQueries.inOut(in, Instant.parse("2026-09-23T13:35:00Z")));
        assertEquals("9h 34m", InboxQueries.hours(Duration.ofMinutes(574)));
        assertEquals("Face", InboxQueries.methodLabel("FACE_RECOGNITION"));
        assertEquals("Mobile", InboxQueries.methodLabel("MOBILE_GPS"));
        assertEquals("Web", InboxQueries.methodLabel("WEB"));
        assertEquals("Travel allowance", InboxQueries.category("TRAVEL_ALLOWANCE"));
        assertEquals("{}", InboxQueries.uuidArray(List.of()));
    }
}
