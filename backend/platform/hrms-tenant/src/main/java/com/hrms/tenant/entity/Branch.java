package com.hrms.tenant.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "branches")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Branch extends BaseEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "code")
    private String code;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "address")
    private String address;

    @Column(name = "city")
    private String city;

    @Column(name = "state")
    private String state;

    @Column(name = "country")
    private String country;

    @Column(name = "pincode")
    private String pincode;

    @Column(name = "latitude")
    private Double latitude;

    @Column(name = "longitude")
    private Double longitude;

    @Column(name = "geo_fence_radius_meters", columnDefinition = "INT DEFAULT 100")
    private int geoFenceRadiusMeters = 100;

    @Column(name = "geo_fence_polygon", columnDefinition = "TEXT")
    private String geoFencePolygon;

    @Column(name = "color_hex", length = 20)
    private String colorHex;

    @Column(name = "icon_key", length = 50)
    private String iconKey;

    @Column(name = "is_headquarters")
    private boolean isHeadquarters;

    @Column(name = "is_active", columnDefinition = "BOOLEAN DEFAULT true")
    private boolean isActive = true;
}
