package com.hrms.attendance.repository;

import com.hrms.attendance.entity.GeoFenceZone;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface GeoFenceZoneRepository extends JpaRepository<GeoFenceZone, UUID> {

    List<GeoFenceZone> findByCompanyIdAndActiveTrue(UUID companyId);

    List<GeoFenceZone> findByBranchIdAndActiveTrue(UUID branchId);
}
