package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(schema = "org", name = "branches")
@Getter
@Setter
public class Branch extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "code", length = 30)
    private String code;

    @Column(name = "address_line", length = 255)
    private String addressLine;
    @Column(name = "city",        length = 100) private String city;
    @Column(name = "state",       length = 100) private String state;
    @Column(name = "country",     length = 50)  private String country;
    @Column(name = "pincode",     length = 15)  private String pincode;

    @Column(name = "latitude",  precision = 10, scale = 7) private BigDecimal latitude;
    @Column(name = "longitude", precision = 10, scale = 7) private BigDecimal longitude;

    @Column(name = "geo_fence_radius_meters")
    private Integer geoFenceRadiusMeters;

    @Column(name = "geo_fence_enforced", nullable = false)
    private boolean geoFenceEnforced;

    @Column(name = "manager_employee_id")
    private UUID managerEmployeeId;

    @Column(name = "employee_count_cached")
    private Integer employeeCountCached;

    @Column(name = "is_headquarters", nullable = false)
    private boolean headquarters;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
