package com.hrms.app.jobs;

import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * Runs daily at 02:00 IST (20:30 UTC prior day) to auto-close any open
 * attendance records for D-1 that have a check-in but no check-out.
 * Employees with no record at all are not touched here — absence marking
 * is handled downstream by the payroll engine.
 */
@Component
@ConditionalOnBean(AttendanceRecordRepository.class)
@DisallowConcurrentExecution
public class AttendanceLogDerivationJob implements Job {

    private static final Logger log = LoggerFactory.getLogger(AttendanceLogDerivationJob.class);

    private final AttendanceRecordRepository attendanceRepo;

    public AttendanceLogDerivationJob(AttendanceRecordRepository attendanceRepo) {
        this.attendanceRepo = attendanceRepo;
    }

    @Override
    @Transactional
    public void execute(JobExecutionContext context) {
        LocalDate targetDate = LocalDate.now().minusDays(1);
        log.info("AttendanceLogDerivationJob: processing date={}", targetDate);

        List<AttendanceRecord> openRecords = attendanceRepo
                .findByAttendanceDateAndCheckOutAtIsNull(targetDate);

        int closed = 0;
        for (AttendanceRecord record : openRecords) {
            if (record.getCheckInAt() != null) {
                record.setCheckOutAt(record.getCheckInAt().plus(Duration.ofHours(9)));
                record.setRegularized(true);
                record.setRegularizationReason("AUTO_CLOSED: no checkout recorded");
                attendanceRepo.save(record);
                closed++;
            }
        }

        log.info("AttendanceLogDerivationJob: auto-closed {} open records for date={}", closed, targetDate);
    }
}
