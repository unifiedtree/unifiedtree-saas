package com.hrms.attendance.entity;

import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "public", name = "geo_fence_zones")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class GeoFenceZone extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "latitude", nullable = false)
    private Double latitude;

    @Column(name = "longitude", nullable = false)
    private Double longitude;

    @Column(name = "radius_meters", nullable = false)
    private Integer radiusMeters = 100;

    @Enumerated(EnumType.STRING)
    @Column(name = "punch_method", nullable = false)
    private CheckInMethod punchMethod = CheckInMethod.FACE_RECOGNITION;

    @Column(name = "color_hex")
    private String colorHex;

    @Column(name = "icon_key")
    private String iconKey;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
