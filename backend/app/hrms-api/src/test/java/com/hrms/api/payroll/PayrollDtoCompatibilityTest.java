package com.hrms.api.payroll;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The redesign only ADDS fields to existing payroll responses: the mobile app
 * reads {@code MyPayslipDto} and {@code PayslipDto}, and the web reads the rest.
 * Each old field keeps its name, type and position, and new fields come last.
 */
class PayrollDtoCompatibilityTest {

    private static List<String> names(Class<?> record) {
        return Arrays.stream(record.getRecordComponents()).map(RecordComponent::getName).toList();
    }

    private static void startsWith(Class<?> record, List<String> before, List<String> added) {
        List<String> now = names(record);
        assertEquals(before, now.subList(0, before.size()), record.getSimpleName() + ": the old fields are unchanged and in order");
        assertEquals(added, now.subList(before.size(), now.size()), record.getSimpleName() + ": only these are new, at the end");
    }

    @Test
    void myPayslipRowKeepsEveryFieldTheMobileAppReads() {
        startsWith(PayrollRunService.MyPayslipDto.class,
                List.of("runId", "period", "periodMonth", "periodYear", "paidDays", "lopDays", "gross",
                        "totalDeductions", "netPay", "status", "lockedAt"),
                List.of("payDate", "paidAt", "totalDays", "notes"));
        RecordComponent[] c = PayrollRunService.MyPayslipDto.class.getRecordComponents();
        assertEquals(UUID.class, c[0].getType());
        assertEquals(int.class, c[2].getType());
        assertEquals(BigDecimal.class, c[8].getType());
        assertEquals(String.class, c[10].getType());
    }

    @Test
    void myPayslipRowSerialisesTheOldFieldsAsBefore() throws Exception {
        UUID run = UUID.fromString("7ccc3d62-039a-43a0-a76d-10303afc9d90");
        PayrollRunService.MyPayslipDto row = new PayrollRunService.MyPayslipDto(run, "Sep 2026", 9, 2026,
                new BigDecimal("30.00"), new BigDecimal("0.00"), new BigDecimal("30000.00"), new BigDecimal("0.00"),
                new BigDecimal("30000.00"), "LOCKED", "2026-09-22T14:48:58Z",
                "2026-09-28", null, 30, List.of(new PayrollRunService.PayslipNoteDto("PLI", "Performance incentive",
                        new BigDecimal("500"), null)));
        JsonNode json = new ObjectMapper().valueToTree(row);
        assertEquals(run.toString(), json.get("runId").asText());
        assertEquals("Sep 2026", json.get("period").asText());
        assertEquals(9, json.get("periodMonth").asInt());
        assertEquals(2026, json.get("periodYear").asInt());
        String text = new ObjectMapper().writeValueAsString(row);
        assertTrue(text.contains("\"paidDays\":30.00"), text);
        assertTrue(text.contains("\"netPay\":30000.00"), text);
        assertEquals("LOCKED", json.get("status").asText());
        assertEquals("2026-09-22T14:48:58Z", json.get("lockedAt").asText());
        assertEquals("2026-09-28", json.get("payDate").asText());
        assertTrue(json.get("paidAt").isNull());
        assertEquals("PLI", json.get("notes").get(0).get("kind").asText());
    }

    @Test
    void payslipKeepsItsFieldsAndAddsTheBankLine() {
        startsWith(PayrollRunService.PayslipDto.class,
                List.of("runId", "employeeId", "employeeName", "employeeCode", "designation", "period", "panMasked",
                        "bankMasked", "paidDays", "lopDays", "earnings", "deductions", "employerContributions",
                        "gross", "totalDeductions", "netPay", "department", "totalDays", "runStatus"),
                List.of("bankName", "bankLast4"));
    }

    @Test
    void runAndRunEmployeeRowsOnlyGrow() {
        startsWith(PayrollRunService.RunDto.class,
                List.of("id", "companyId", "companyName", "periodMonth", "periodYear", "periodStart", "periodEnd",
                        "status", "employeeCount", "totalGross", "totalDeductions", "totalNet", "processedAt",
                        "lockedAt", "createdAt", "skippedEmployeeCount", "payDate", "workingDays", "createdByName",
                        "processedByName", "lockedByName", "paidByName"),
                List.of("employerContributions", "paidAt"));
        startsWith(PayrollRunService.RunEmployeeDto.class,
                List.of("employeeId", "employeeCode", "employeeName", "paidDays", "lopDays", "gross", "deductions",
                        "netPay"),
                List.of("department", "branch", "designation", "dateOfJoining", "previousGross", "previousNet",
                        "changePercent", "newJoiner", "hasBankAccount", "fnfInProgress", "reviewReasons"));
        startsWith(PayrollDashboardService.KpisDto.class,
                List.of("totalPayrollCost", "averageSalary", "pendingDisbursals", "tdsLiability", "currentPeriodLabel",
                        "currentPeriodMonth", "currentPeriodYear"),
                List.of("pendingDisbursalAmount"));
    }

    @Test
    void theMonthBeingPreparedCarriesNoFigures() {
        // An employee never sees draft or processing numbers (the server rule behind My payslips).
        for (RecordComponent c : MyPayService.UpcomingDto.class.getRecordComponents()) {
            assertNotEquals(BigDecimal.class, c.getType(), "no amount on the month being prepared: " + c.getName());
        }
        assertEquals(List.of("period", "periodMonth", "periodYear", "payDate", "status"), names(MyPayService.UpcomingDto.class));
    }

    @Test
    void theScheduleIsExactlyTheSharedContract() {
        // apps/platform/src/modules/hrms/api/shared/contracts.ts → PaySchedule
        assertEquals(List.of("nextPayDate", "processingDay"), names(MyPayService.PayScheduleDto.class));
    }
}
