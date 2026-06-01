package com.hrms.app.jobs;

import org.quartz.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class QuartzJobConfig {

    // ── Attendance daily log derivation — 02:00 IST = 20:30 UTC ─────────────

    @Bean
    public JobDetail attendanceLogDerivationJobDetail() {
        return JobBuilder.newJob(AttendanceLogDerivationJob.class)
                .withIdentity("attendanceLogDerivationJob")
                .withDescription("Auto-close open attendance records for D-1")
                .storeDurably()
                .build();
    }

    @Bean
    public Trigger attendanceLogDerivationTrigger(JobDetail attendanceLogDerivationJobDetail) {
        return TriggerBuilder.newTrigger()
                .forJob(attendanceLogDerivationJobDetail)
                .withIdentity("attendanceLogDerivationTrigger")
                .withSchedule(CronScheduleBuilder.cronSchedule("0 30 20 * * ?")
                        .inTimeZone(java.util.TimeZone.getTimeZone("UTC")))
                .build();
    }

    // ── Leave balance accrual — 1st of month at 00:30 IST = 19:00 UTC ────────

    @Bean
    public JobDetail leaveAccrualJobDetail() {
        return JobBuilder.newJob(LeaveAccrualJob.class)
                .withIdentity("leaveAccrualJob")
                .withDescription("Monthly leave balance initialisation for active employees")
                .storeDurably()
                .build();
    }

    @Bean
    public Trigger leaveAccrualTrigger(JobDetail leaveAccrualJobDetail) {
        return TriggerBuilder.newTrigger()
                .forJob(leaveAccrualJobDetail)
                .withIdentity("leaveAccrualTrigger")
                .withSchedule(CronScheduleBuilder.cronSchedule("0 0 19 1 * ?")
                        .inTimeZone(java.util.TimeZone.getTimeZone("UTC")))
                .build();
    }
}
