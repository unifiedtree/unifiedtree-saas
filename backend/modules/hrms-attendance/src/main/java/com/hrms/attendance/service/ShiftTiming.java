package com.hrms.attendance.service;
import java.time.*;

public final class ShiftTiming {
 private ShiftTiming() {}
 public static Instant expectedEnd(LocalDate attendanceDate, LocalTime start, LocalTime end) {
  LocalDate endDate=end.isAfter(start)?attendanceDate:attendanceDate.plusDays(1);
  return endDate.atTime(end).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
 }
}
