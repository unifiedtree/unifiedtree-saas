package com.hrms.attendance.dto;

public record CheckInRequest(
        double latitude,
        double longitude,
        String faceImageBase64,
        String checkInMethod,
        String locationName,
        String zoneName,
        String deviceId,
        String clientEventId,
        boolean offlineCaptured
) {}
