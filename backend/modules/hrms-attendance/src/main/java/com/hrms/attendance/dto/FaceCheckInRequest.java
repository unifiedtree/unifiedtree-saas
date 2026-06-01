package com.hrms.attendance.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record FaceCheckInRequest(
        @NotNull UUID employeeId,
        @NotNull Double latitude,
        @NotNull Double longitude,
        UUID branchId
) {}
