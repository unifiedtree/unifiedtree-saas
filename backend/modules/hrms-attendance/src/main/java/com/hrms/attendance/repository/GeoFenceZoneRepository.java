package com.hrms.attendance.repository;

import com.hrms.attendance.entity.GeoFenceZone;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GeoFenceZoneRepository extends JpaRepository<GeoFenceZone, UUID> {

    List<GeoFenceZone> findByCompanyIdAndActiveTrue(UUID companyId);

    List<GeoFenceZone> findByBranchIdAndActiveTrue(UUID branchId);

    /**
     * Belt-and-braces tenant lookup (Bundle E, V091). RLS on public.geo_fence_zones
     * blocks cross-tenant reads at the DB layer, but callers on the PUT/DELETE
     * /v1/attendance/geofence/zones/{zoneId} paths must additionally scope by
     * tenantId so a missing session GUC (e.g. under REQUIRES_NEW / @Async /
     * AFTER_COMMIT) surfaces as a 404 instead of a silent zero-row leak. See
     * V091__rls_hardening.sql and finding "public.geo_fence_zones IDOR".
     */
    Optional<GeoFenceZone> findByIdAndTenantId(UUID id, UUID tenantId);
}
