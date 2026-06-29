package com.hrms.advance.dto;

public record AdvanceDecisionRequest(
        boolean approved,
        String comment
) {}
