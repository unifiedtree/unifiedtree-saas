package com.hrms.api.otp;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Public, unauthenticated feature-flag endpoint the mobile app hits on cold
 * start (and before mounting the /login screen) to pick which OTP provider
 * to run — MSG91 or the legacy Firebase phone-auth path.
 *
 * <p>Read order (highest precedence first):
 * <ol>
 *   <li>{@code OTP_FEATURE_FLAG_OVERRIDE} env var — ops kill-switch. Set to
 *       {@code firebase} to force every caller back onto the old path
 *       without a redeploy (Cloud Run env change triggers a restart).</li>
 *   <li>{@code OTP_FEATURE_FLAG} env var — default provider. Ships as
 *       {@code firebase} for backward-compat until we flip in phase 3.</li>
 * </ol>
 *
 * <p>Response is small and side-effect-free; cached 5 min at the edge and by
 * the client so a slow MSG91 does not fan out to every cold-start of the
 * app. Packaged alongside {@link OtpController} so the same
 * canonical-profile component scan entry ({@code com.hrms.api.otp}) picks
 * both up.
 */
@RestController
@RequestMapping("/v1/public")
public class OtpProviderController {

    private static final String PROVIDER_MSG91    = "msg91";
    private static final String PROVIDER_FIREBASE = "firebase";

    private final String defaultProvider;
    private final String overrideProvider;
    private final int    otpLength;
    private final int    ttlSeconds;
    private final int    resendCooldownSeconds;

    public OtpProviderController(
            @Value("${otp.provider:firebase}") String defaultProvider,
            @Value("${otp.provider-override:}") String overrideProvider,
            @Value("${otp.length:6}") int otpLength,
            @Value("${otp.ttl-minutes:10}") int ttlMinutes,
            @Value("${otp.resend-cooldown-seconds:60}") int resendCooldownSeconds) {
        this.defaultProvider = normalize(defaultProvider, PROVIDER_FIREBASE);
        this.overrideProvider = normalize(overrideProvider, "");
        this.otpLength = otpLength;
        this.ttlSeconds = ttlMinutes * 60;
        this.resendCooldownSeconds = resendCooldownSeconds;
    }

    @GetMapping("/otp-provider")
    public ResponseEntity<Map<String, Object>> getOtpProvider() {
        String provider = (!overrideProvider.isBlank()) ? overrideProvider : defaultProvider;
        if (!PROVIDER_MSG91.equals(provider) && !PROVIDER_FIREBASE.equals(provider)) {
            // Unknown value — fail safe to firebase; every currently-installed
            // AAB knows how to run the old code path.
            provider = PROVIDER_FIREBASE;
        }
        Map<String, Object> body = Map.of(
                "provider", provider,
                "supportedRegions", List.of("IN"),
                "region", "IN",
                "otpLength", otpLength,
                "ttlSeconds", ttlSeconds,
                "resendCooldownSeconds", resendCooldownSeconds
        );
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .body(body);
    }

    private static String normalize(String s, String fallback) {
        if (s == null) return fallback;
        String t = s.trim().toLowerCase(Locale.ROOT);
        return t.isEmpty() ? fallback : t;
    }
}
