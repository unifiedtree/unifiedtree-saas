package com.hrms.letters.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record VoidLetterRequest(
        @NotBlank(message = "Void reason is required")
        @Size(max = 500)
        String reason
) {}
