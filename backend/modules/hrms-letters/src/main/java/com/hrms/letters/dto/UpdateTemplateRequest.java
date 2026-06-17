package com.hrms.letters.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateTemplateRequest(
        @Size(max = 200)
        String name,

        @Pattern(regexp = "OFFER|APPOINTMENT|RELIEVING|EXPERIENCE|SALARY_REVISION|CUSTOM",
                 message = "Type must be one of: OFFER, APPOINTMENT, RELIEVING, EXPERIENCE, SALARY_REVISION, CUSTOM")
        String type,

        @Size(max = 500)
        String subject,

        String bodyHtml,

        Boolean active,

        String variantName
) {}
