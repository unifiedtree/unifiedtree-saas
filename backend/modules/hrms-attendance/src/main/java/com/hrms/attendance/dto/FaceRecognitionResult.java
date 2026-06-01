package com.hrms.attendance.dto;

public record FaceRecognitionResult(
        boolean matched,
        double confidenceScore,
        String employeeId,
        String message
) {}
