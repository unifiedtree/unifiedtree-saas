package com.hrms.attendance.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "public", name = "geo_fence_audits")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class GeoFenceAudit extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "latitude", nullable = false)
    private Double latitude;

    @Column(name = "longitude", nullable = false)
    private Double longitude;

    @Column(name = "within_fence", nullable = false)
    private boolean withinFence;

    @Column(name = "distance_meters")
    private Double distanceMeters;

    // Possible values: CHECKIN_ALLOWED, WFH_PROMPTED, DENIED
    @Column(name = "action_taken")
    private String actionTaken;
}
