package com.hrms.leave.dto;

import jakarta.validation.constraints.Size;

/**
 * Body for POST /v1/wfh/{id}/approve and /reject. The comment is optional on
 * approve and required on reject (validated in the controller so we can give
 * a domain-specific error message instead of a generic bean-validation one).
 */
public record WfhDecisionRequest(
        @Size(max = 500, message = "Comment must be 500 characters or fewer")
        String comment
) {
}
