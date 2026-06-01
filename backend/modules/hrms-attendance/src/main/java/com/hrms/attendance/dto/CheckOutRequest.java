package com.hrms.attendance.dto;

import java.util.UUID;

public record CheckOutRequest(
        UUID employeeId,
        Double latitude,
        Double longitude,
        String checkOutMethod,
        String locationName,
        String zoneName,
        String deviceId,
        String clientEventId
) {}
