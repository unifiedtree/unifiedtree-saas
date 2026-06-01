package com.hrms.letters.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateTemplateRequest(
        @NotNull(message = "Company ID is required")
        UUID companyId,

        @NotBlank(message = "Name is required")
        @Size(max = 200)
        String name,

        @NotBlank(message = "Type is required")
        @Pattern(regexp = "OFFER|APPOINTMENT|RELIEVING|EXPERIENCE|SALARY_REVISION|CUSTOM",
                 message = "Type must be one of: OFFER, APPOINTMENT, RELIEVING, EXPERIENCE, SALARY_REVISION, CUSTOM")
        String type,

        @NotBlank(message = "Subject is required")
        @Size(max = 500)
        String subject,

        @NotBlank(message = "Body HTML is required")
        String bodyHtml,

        String variantName
) {}
