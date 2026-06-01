package com.hrms.auth.dto;

import java.util.UUID;

public record MobileOtpResponse(
        UUID requestId,
        String mobileNumber,
        int expiresInSeconds,
        int resendAfterSeconds,
        String message,
        String debugOtp
) {
}
