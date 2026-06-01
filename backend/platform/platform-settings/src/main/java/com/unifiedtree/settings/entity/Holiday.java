package com.unifiedtree.settings.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(schema = "settings", name = "holiday_calendar")
@Getter
@Setter
public class Holiday extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "year", nullable = false)
    private Integer year;

    @Column(name = "holiday_date", nullable = false)
    private LocalDate holidayDate;

    @Column(name = "holiday_name", nullable = false, length = 150)
    private String holidayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "holiday_type", nullable = false, length = 30)
    private HolidayType holidayType = HolidayType.COMPANY;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    public enum HolidayType { NATIONAL, FESTIVAL, RESTRICTED, REGIONAL, OPTIONAL, COMPANY }
}
