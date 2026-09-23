package com.hrms.attendance.service;
import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class ShiftTimingTest {
 @Test void overnightEndUsesTheNextDate() {
  Instant end=ShiftTiming.expectedEnd(LocalDate.of(2026,9,23),LocalTime.of(22,0),LocalTime.of(6,0));
  assertEquals(Instant.parse("2026-09-24T00:30:00Z"),end);
  assertTrue(Instant.parse("2026-09-23T18:00:00Z").isBefore(end),"23:30 checkout before midnight is early");
  assertTrue(Instant.parse("2026-09-24T00:00:00Z").isBefore(end),"05:30 checkout is early");
  assertFalse(Instant.parse("2026-09-24T00:31:00Z").isBefore(end),"06:01 checkout is not early");
 }
 @Test void dayShiftUsesAttendanceDateEvenWhenCheckoutIsAfterMidnight() {
  Instant end=ShiftTiming.expectedEnd(LocalDate.of(2026,9,23),LocalTime.of(9,0),LocalTime.of(18,0));
  assertEquals(Instant.parse("2026-09-23T12:30:00Z"),end);
  assertFalse(Instant.parse("2026-09-23T20:00:00Z").isBefore(end));
 }
}
