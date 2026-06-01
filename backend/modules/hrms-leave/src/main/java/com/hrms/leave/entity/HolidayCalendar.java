package com.hrms.leave.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "leave_mgmt", name = "holiday_calendars")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class HolidayCalendar extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "holiday_date", nullable = false)
    private LocalDate holidayDate;

    @Column(name = "year", nullable = false)
    private int year;

    @Column(name = "is_optional")
    private boolean optional = false;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;
}
