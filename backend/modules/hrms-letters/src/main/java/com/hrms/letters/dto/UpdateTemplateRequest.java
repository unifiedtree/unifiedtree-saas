package com.hrms.letters.dto;

import jakarta.validation.constraints.Size;

public record UpdateTemplateRequest(
        @Size(max = 200)
        String name,

        @Size(max = 500)
        String subject,

        String bodyHtml,

        Boolean active,

        String variantName
) {}
