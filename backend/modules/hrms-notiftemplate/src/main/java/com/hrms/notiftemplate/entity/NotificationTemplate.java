package com.hrms.notiftemplate.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.notiftemplate.enums.NotificationChannel;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "notiftemplate_mgmt",
        name = "notification_templates"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class NotificationTemplate extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", nullable = false, length = 20)
    private NotificationChannel channel;

    // Domain event this template renders for (e.g. "leave.approved", "payslip.published").
    @Column(name = "event_key", nullable = false, length = 80)
    private String eventKey;

    // Optional — channels such as SMS / PUSH may not carry a subject line.
    @Column(name = "subject", length = 300)
    private String subject;

    @Column(name = "body", columnDefinition = "TEXT")
    private String body;

    @Column(name = "active")
    private boolean active = true;
}
