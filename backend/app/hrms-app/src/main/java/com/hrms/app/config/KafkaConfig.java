package com.hrms.app.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.support.converter.JsonMessageConverter;
import org.springframework.kafka.support.converter.RecordMessageConverter;

@Configuration
@ConditionalOnProperty(name = "hrms.kafka.enabled", havingValue = "true")
public class KafkaConfig {

    // Attendance
    @Bean
    public NewTopic attendanceCheckinTopic() {
        return TopicBuilder.name("attendance.checkin.v1").partitions(6).replicas(1).build();
    }

    // Leave
    @Bean
    public NewTopic leaveRequestedTopic() {
        return TopicBuilder.name("leave.requested.v1").partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic leaveApprovedTopic() {
        return TopicBuilder.name("leave.approved.v1").partitions(3).replicas(1).build();
    }

    // Employee lifecycle
    @Bean
    public NewTopic employeeOnboardedTopic() {
        return TopicBuilder.name("employee.onboarded.v1").partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic employeeOffboardedTopic() {
        return TopicBuilder.name("employee.offboarded.v1").partitions(3).replicas(1).build();
    }

    // Payroll
    @Bean
    public NewTopic payrollRunCompletedTopic() {
        return TopicBuilder.name("payroll.run.completed.v1").partitions(3).replicas(1).build();
    }

    // Expense
    @Bean
    public NewTopic expenseSubmittedTopic() {
        return TopicBuilder.name("expense.submitted.v1").partitions(3).replicas(1).build();
    }

    // Notifications (dead-letter)
    @Bean
    public NewTopic notificationDltTopic() {
        return TopicBuilder.name("hrms.notifications.dlt").partitions(1).replicas(1).build();
    }

    @Bean
    public RecordMessageConverter messageConverter() {
        return new JsonMessageConverter();
    }
}
