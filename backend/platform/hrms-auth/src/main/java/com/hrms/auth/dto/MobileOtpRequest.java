package com.hrms.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record MobileOtpRequest(
        @NotBlank
        @Pattern(regexp = "^\\+?\\d{10,15}$", message = "Mobile number must contain 10 to 15 digits")
        String mobileNumber,
        String deviceFingerprint
) {
}
