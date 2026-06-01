package com.hrms.attendance.service;

import com.hrms.attendance.dto.GeoValidateRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.entity.GeoFenceAudit;
import com.hrms.attendance.repository.GeoFenceAuditRepository;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class GeoValidationService {

    private static final Logger log = LoggerFactory.getLogger(GeoValidationService.class);
    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    private final GeoFenceAuditRepository auditRepository;

    @Value("${hrms.attendance.geo-fence-radius-meters:100}")
    private int defaultRadiusMeters;

    public GeoValidationService(GeoFenceAuditRepository auditRepository) {
        this.auditRepository = auditRepository;
    }

    @Transactional
    public GeoValidateResponse validate(GeoValidateRequest request, UUID branchId,
                                        Double branchLat, Double branchLon, int radiusMeters) {
        boolean withinFence;
        double distance;

        if (branchLat == null || branchLon == null) {
            withinFence = true;
            distance = 0.0;
            log.debug("No geofence configured for branch={}, allowing check-in", branchId);
        } else {
            distance = haversineDistance(request.latitude(), request.longitude(), branchLat, branchLon);
            withinFence = distance <= radiusMeters;
        }

        GeoFenceAudit audit = new GeoFenceAudit();
        audit.setTenantId(TenantContext.getTenantId());
        audit.setEmployeeId(request.employeeId());
        audit.setBranchId(branchId);
        audit.setLatitude(request.latitude());
        audit.setLongitude(request.longitude());
        audit.setWithinFence(withinFence);
        audit.setDistanceMeters(distance);
        audit.setActionTaken(withinFence ? "CHECKIN_ALLOWED" : "WFH_PROMPTED");
        auditRepository.save(audit);

        log.debug("Geo validation: employee={}, distance={}m, withinFence={}", request.employeeId(), distance, withinFence);

        return new GeoValidateResponse(
                withinFence,
                branchId,
                null,
                distance,
                withinFence
                        ? "Location verified — you may proceed with check-in"
                        : "You are %.0f meters outside the office boundary.".formatted(distance - radiusMeters)
        );
    }

    private double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
