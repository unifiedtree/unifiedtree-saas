package com.hrms.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.util.UUID;

public record VerifyOtpRequest(
        @NotNull UUID requestId,
        @NotBlank
        @Pattern(regexp = "^\\+?\\d{10,15}$", message = "Mobile number must contain 10 to 15 digits")
        String mobileNumber,
        @NotBlank
        @Pattern(regexp = "^\\d{6}$", message = "OTP must be 6 digits")
        String otp,
        String deviceFingerprint
) {
}
