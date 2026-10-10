package com.hrms.api.attendance;

import com.hrms.api.payroll.PayrollCalc;
import com.hrms.leave.mapper.LeaveBalanceMapperImpl;
import com.hrms.leave.mapper.LeaveRequestMapperImpl;
import com.hrms.leave.repository.HolidayCalendarRepository;
import com.hrms.leave.repository.LeaveBalanceRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.hrms.leave.repository.LeaveTypeRepository;
import com.hrms.leave.service.LeaveService;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * The three weekly-off rules there are today (shift-ot GAP-MAP §2.3), side by side on the same inputs, as they were
 * before the shift lookups were replaced by one resolver. They are NOT the same rule and must stay apart until the
 * owner decides otherwise:
 * <ul>
 *   <li>attendance: the person's own days, else the shift's, else the company's, else Saturday and Sunday;</li>
 *   <li>payroll (loss of pay): own, else the company's, else Saturday and Sunday; no shift step;</li>
 *   <li>leave day counting: the company's only, else Saturday and Sunday.</li>
 * </ul>
 */
class WeeklyOffRulesCharacterizationTest {

    /** Attendance, as the team schedule applies it to one day's own, shift and company values. */
    private static Set<Integer> attendance(String own, String shift, Integer[] company) {
        return TeamScheduleController.weeklyOffDays(own, shift, company == null ? null
                : Arrays.stream(company).map(String::valueOf).collect(Collectors.joining(",")));
    }

    private static Set<Integer> payroll(String own, Integer[] company) {
        return PayrollCalc.resolveOffDays(own, PayrollCalc.companyOffDays(company));
    }

    @SuppressWarnings("unchecked")
    private static Set<Integer> leave(Integer[] company) {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(inv -> company).when(jdbc).query(contains("weekend_days"), any(ResultSetExtractor.class), any(Object[].class));
        KafkaTemplate<String, Object> kafka = mock(KafkaTemplate.class);
        LeaveService service = new LeaveService(mock(LeaveTypeRepository.class), mock(LeaveBalanceRepository.class),
                mock(LeaveRequestRepository.class), mock(HolidayCalendarRepository.class), kafka, new LeaveRequestMapperImpl(),
                new LeaveBalanceMapperImpl(), jdbc, mock(ApplicationEventPublisher.class), false);
        return ReflectionTestUtils.invokeMethod(service, "resolveOffDays", UUID.randomUUID());
    }

    private static void rules(String own, String shift, Integer[] company,
                              Set<Integer> attendance, Set<Integer> payroll, Set<Integer> leave) {
        String what = "own=" + own + " shift=" + shift + " company=" + Arrays.toString(company);
        assertEquals(attendance, attendance(own, shift, company), "attendance " + what);
        assertEquals(payroll, payroll(own, company), "payroll " + what);
        assertEquals(leave, leave(company), "leave " + what);
    }

    @Test void ownDaysWinForAttendanceAndPayrollButNotForLeave() {
        rules("5", "3", new Integer[]{7}, Set.of(5), Set.of(5), Set.of(7));
        rules(" 1 , 2 ", "3", null, Set.of(1, 2), Set.of(1, 2), Set.of(6, 7));
    }

    @Test void onlyAttendanceHasAShiftStep() {
        rules(null, "3", new Integer[]{7}, Set.of(3), Set.of(7), Set.of(7));
        rules("", "3,4", new Integer[]{5, 6}, Set.of(3, 4), Set.of(5, 6), Set.of(5, 6));
    }

    @Test void theCompanysDaysElseSaturdayAndSunday() {
        rules("", null, new Integer[]{5, 6}, Set.of(5, 6), Set.of(5, 6), Set.of(5, 6));
        rules(null, null, new Integer[]{}, Set.of(6, 7), Set.of(6, 7), Set.of(6, 7));
        rules(null, null, null, Set.of(6, 7), Set.of(6, 7), Set.of(6, 7));
    }

    @Test void junkAndOutOfRangeDaysAreIgnoredEverywhere() {
        rules("junk", "9", new Integer[]{0, 8}, Set.of(6, 7), Set.of(6, 7), Set.of(6, 7));
        rules("junk,4", "0", new Integer[]{0, 3}, Set.of(4), Set.of(4), Set.of(3));
    }
}
