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

    // ── Leave accrual + January carry forward — daily at 00:30 IST = 19:00 UTC ─
    // Daily rather than monthly (V143.23): the job is idempotent per period, so
    // a night the instance missed is caught up the next night.

    @Bean
    public JobDetail leaveAccrualJobDetail() {
        return JobBuilder.newJob(LeaveAccrualJob.class)
                .withIdentity("leaveAccrualJob")
                .withDescription("Daily leave accrual (balances, monthly/quarterly credits) and the January carry forward")
                .storeDurably()
                .build();
    }

    @Bean
    public Trigger leaveAccrualTrigger(JobDetail leaveAccrualJobDetail) {
        return TriggerBuilder.newTrigger()
                .forJob(leaveAccrualJobDetail)
                .withIdentity("leaveAccrualTrigger")
                .withSchedule(CronScheduleBuilder.cronSchedule("0 0 19 * * ?")
                        .inTimeZone(java.util.TimeZone.getTimeZone("UTC")))
                .build();
    }
}
