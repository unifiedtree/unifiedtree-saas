package com.hrms.fnf.dto;

import com.hrms.fnf.enums.FnfComponentType;

import java.math.BigDecimal;
import java.util.UUID;

public record FnfComponentResponse(
        UUID id,
        String label,
        FnfComponentType type,
        BigDecimal amount
) {}
