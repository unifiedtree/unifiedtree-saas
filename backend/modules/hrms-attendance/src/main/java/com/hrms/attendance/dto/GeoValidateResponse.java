package com.hrms.attendance.dto;

import java.util.UUID;

public record GeoValidateResponse(
        boolean withinFence,
        UUID branchId,
        String branchName,
        Double distanceMeters,
        String message
) {}
