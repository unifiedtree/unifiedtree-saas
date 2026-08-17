package com.hrms.api.otp;

import com.hrms.core.exception.HrmsException;
import com.hrms.notification.msg91.Msg91Client;
import com.hrms.notification.msg91.Msg91Client.Msg91SendResult;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.entity.OtpRequest;
import com.unifiedtree.auth.otp.OtpService;
import com.unifiedtree.auth.otp.OtpService.NewOtp;
import com.unifiedtree.auth.otp.OtpService.VerifyOutcome;
import com.unifiedtree.auth.phone.PhoneLookupService;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * MSG91 phone-auth OTP endpoints. Response shapes are provider-agnostic so
 * the mobile app can consume the same {@link LoginResponse} it already gets
 * from {@code /v1/auth/firebase-verify}.
 *
 * <p>All transactional writes are delegated to {@link OtpService} — this
 * controller is a thin HTTP shell around it.
 *
 * <p>Enum-leak protection: {@code /request} always returns 200 with an
 * opaque request id, even for unregistered numbers. Membership disclosure
 * is deferred to {@code /verify} — which only fires AFTER the caller
 * proved possession of the phone.
 */
@RestController
@RequestMapping("/v1/auth/otp")
public class OtpController {

    private static final Logger log = LoggerFactory.getLogger(OtpController.class);

    private static final String ENDPOINT_REQUEST = "otp-request";
    private static final String ENDPOINT_VERIFY  = "otp-verify";
    private static final String ENDPOINT_RESEND  = "otp-resend";

    /** Sliding-window caps on per-phone SEND attempts. */
    private static final int PHONE_SENDS_PER_5MIN = 3;
    private static final int PHONE_SENDS_PER_HOUR = 10;
    private static final int PHONE_SENDS_PER_DAY  = 30;

    private final OtpService otpService;
    private final Msg91Client msg91;
    private final PhoneLookupService phoneLookup;
    private final AuthService auth;
    private final PublicEndpointRateLimiter rateLimiter;

    private final int resendCooldownSeconds;

    public OtpController(OtpService otpService,
                         Msg91Client msg91,
                         PhoneLookupService phoneLookup,
                         AuthService auth,
                         PublicEndpointRateLimiter rateLimiter,
                         @Value("${otp.resend-cooldown-seconds:60}") int resendCooldownSeconds) {
        this.otpService = otpService;
        this.msg91 = msg91;
        this.phoneLookup = phoneLookup;
        this.auth = auth;
        this.rateLimiter = rateLimiter;
        this.resendCooldownSeconds = resendCooldownSeconds;
    }

    // ── /request ─────────────────────────────────────────────────────────────

    @PostMapping("/request")
    public ResponseEntity<?> request(@Valid @RequestBody OtpRequestBody req, HttpServletRequest http) {
        String phone = normalizePhone(req.mobile());
        String phoneLast10 = last10(phone);

        // Layer 1 — per-IP burst limit (existing rate limiter, endpoint-scoped).
        rateLimiter.check(ENDPOINT_REQUEST, clientIp(http), null);

        // Layer 2 — per-phone sliding window against otp_requests.
        checkPhoneRateLimits(phoneLast10);

        NewOtp newOtp = otpService.createNewOtp(
                phoneLast10, phone, req.purposeOrDefault(), clientIp(http), safeUserAgent(http));

        // Send via MSG91 outside the transaction so a slow provider does not
        // hold the DB connection. On failure we still return 200 with the
        // opaque request id — the ops alert on send failures is oncall's
        // ground truth; leaking provider details would give an attacker a
        // free membership oracle.
        Msg91SendResult send = msg91.sendOtp(phone, newOtp.plainOtp(),
                newOtp.entity().getCorrelationId());
        if (send.success()) {
            otpService.recordMsg91RequestId(newOtp.entity().getId(), send.requestId());
        } else {
            log.error("otp/request MSG91 send FAILED requestId={} correlationId={} errorCode={} httpStatus={}",
                    newOtp.entity().getId(), newOtp.entity().getCorrelationId(),
                    send.errorCode(), send.httpStatus());
        }

        return ResponseEntity.ok(Map.of(
                "requestId", newOtp.entity().getId().toString(),
                "expiresAt", newOtp.entity().getExpiresAt().toString(),
                "resendAvailableAt", newOtp.entity().getSentAt()
                        .plusSeconds(resendCooldownSeconds).toString(),
                "maskedMobile", maskForResponse(phone)
        ));
    }

    // ── /verify ──────────────────────────────────────────────────────────────

    @PostMapping("/verify")
    public ResponseEntity<?> verify(@Valid @RequestBody OtpVerifyBody req, HttpServletRequest http) {
        rateLimiter.check(ENDPOINT_VERIFY, clientIp(http), null);

        UUID requestId = parseUuid(req.requestId(), "INVALID_REQUEST_ID");
        String otp = req.otp() == null ? "" : req.otp().trim();
        if (!otp.matches("^[0-9]{6}$")) {
            throw new HrmsException("OTP must be 6 digits.", HttpStatus.BAD_REQUEST, "INVALID_OTP_FORMAT");
        }

        VerifyOutcome outcome = otpService.attemptVerify(requestId, otp);
        switch (outcome.kind()) {
            case EXPIRED -> throw new HrmsException("OTP has expired. Please request a new code.",
                    HttpStatus.GONE, "OTP_EXPIRED");
            case REVOKED -> throw new HrmsException("This OTP is no longer valid. Please request a new one.",
                    HttpStatus.GONE, "OTP_REVOKED");
            case ALREADY_USED -> throw new HrmsException("This OTP has already been used.",
                    HttpStatus.GONE, "OTP_ALREADY_USED");
            case LOCKED -> throw new HrmsException("Too many wrong attempts. Please request a new OTP.",
                    HttpStatus.LOCKED, "OTP_TOO_MANY_ATTEMPTS");
            case NOT_FOUND -> throw new HrmsException("Unknown OTP request.",
                    HttpStatus.BAD_REQUEST, "INVALID_REQUEST_ID");
            case WRONG -> {
                int remaining = Math.max(0, outcome.attemptsRemaining());
                throw new HrmsException(
                        "Incorrect OTP. " + remaining + " attempts remaining.",
                        HttpStatus.UNAUTHORIZED, "OTP_INVALID");
            }
            case OK -> { /* fall through */ }
        }

        // Success — resolve phone → tenant + user, issue session.
        Optional<PhoneLookupService.Match> match = phoneLookup.findByPhone(outcome.phoneE164());
        if (match.isEmpty()) {
            log.info("otp/verify: no employee found for verified phone requestId={}", requestId);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "error", "PHONE_NOT_REGISTERED",
                    "message", "This phone number is not registered. Contact your HR administrator."));
        }
        PhoneLookupService.Match m = match.get();

        // Bind tenant BEFORE calling AuthService — TenantAwareDataSource reads
        // TenantContext at connection-lease time to SET LOCAL app.tenant_id,
        // otherwise RLS hides the user_credentials row. Same setup the
        // Firebase controller does before calling issueWorkspaceSession.
        TenantContext.setTenantId(m.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(m.tenantId());

        LoginResponse out = auth.issueWorkspaceSession(m.tenantId(), m.authUserId());
        log.info("otp/verify OK requestId={} tenant={} user={}", requestId, m.tenantId(), m.authUserId());
        return ResponseEntity.ok(out);
    }

    // ── /resend ──────────────────────────────────────────────────────────────

    @PostMapping("/resend")
    public ResponseEntity<?> resend(@Valid @RequestBody OtpResendBody req, HttpServletRequest http) {
        rateLimiter.check(ENDPOINT_RESEND, clientIp(http), null);

        UUID requestId = parseUuid(req.requestId(), "INVALID_REQUEST_ID");
        OtpRequest existing = otpService.findById(requestId)
                .orElseThrow(() -> new HrmsException("Unknown OTP request.",
                        HttpStatus.BAD_REQUEST, "INVALID_REQUEST_ID"));

        // Cooldown: refuse if the previous send is younger than the cooldown.
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime cooldownExpiry = existing.getSentAt().plusSeconds(resendCooldownSeconds);
        if (now.isBefore(cooldownExpiry)) {
            long retryAfter = Math.max(1, Duration.between(now, cooldownExpiry).getSeconds());
            throw new HrmsException("Please wait " + retryAfter + " seconds before requesting another OTP.",
                    HttpStatus.TOO_MANY_REQUESTS, "RESEND_COOLDOWN");
        }

        String phoneLast10 = existing.getPhoneLast10();
        String phoneE164   = existing.getPhoneE164();

        // Sliding-window caps count resends too.
        checkPhoneRateLimits(phoneLast10);

        NewOtp newOtp = otpService.createNewOtp(
                phoneLast10, phoneE164, existing.getPurpose(), clientIp(http), safeUserAgent(http));

        Msg91SendResult send = msg91.sendOtp(phoneE164, newOtp.plainOtp(),
                newOtp.entity().getCorrelationId());
        if (send.success()) {
            otpService.recordMsg91RequestId(newOtp.entity().getId(), send.requestId());
        } else {
            log.error("otp/resend MSG91 send FAILED requestId={} correlationId={} errorCode={}",
                    newOtp.entity().getId(), newOtp.entity().getCorrelationId(), send.errorCode());
        }

        return ResponseEntity.ok(Map.of(
                "requestId", newOtp.entity().getId().toString(),
                "expiresAt", newOtp.entity().getExpiresAt().toString(),
                "resendAvailableAt", newOtp.entity().getSentAt()
                        .plusSeconds(resendCooldownSeconds).toString()
        ));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void checkPhoneRateLimits(String phoneLast10) {
        OffsetDateTime now = OffsetDateTime.now();
        if (otpService.countSendsSince(phoneLast10, now.minusMinutes(5)) >= PHONE_SENDS_PER_5MIN) {
            throw new HrmsException(
                    "Too many OTP requests for this number. Please wait a few minutes.",
                    HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_5MIN");
        }
        if (otpService.countSendsSince(phoneLast10, now.minusHours(1)) >= PHONE_SENDS_PER_HOUR) {
            throw new HrmsException(
                    "Hourly OTP request limit reached for this number.",
                    HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_HOUR");
        }
        if (otpService.countSendsSince(phoneLast10, now.minusDays(1)) >= PHONE_SENDS_PER_DAY) {
            throw new HrmsException(
                    "Daily OTP request limit reached for this number.",
                    HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_DAY");
        }
    }

    private static String normalizePhone(String raw) {
        if (raw == null) {
            throw new HrmsException("Mobile number is required.", HttpStatus.BAD_REQUEST, "INVALID_MOBILE");
        }
        String digits = raw.trim().replaceAll("\\D", "");
        // Accept +91XXXXXXXXXX, 91XXXXXXXXXX, or bare XXXXXXXXXX (10 digits).
        if (digits.length() == 10) digits = "91" + digits;
        if (digits.length() != 12 || !digits.startsWith("91")) {
            throw new HrmsException("Mobile must be a valid Indian +91 number.",
                    HttpStatus.BAD_REQUEST, "INVALID_MOBILE");
        }
        return "+" + digits;
    }

    private static String last10(String phoneE164) {
        String digits = phoneE164.replaceAll("\\D", "");
        return digits.substring(digits.length() - 10);
    }

    private static String maskForResponse(String phoneE164) {
        String digits = phoneE164.replaceAll("\\D", "");
        String tail = digits.substring(digits.length() - 4);
        return "+91XXXXXX" + tail;
    }

    private static UUID parseUuid(String s, String errorCode) {
        try {
            return UUID.fromString(s);
        } catch (Exception e) {
            throw new HrmsException("Invalid request id.", HttpStatus.BAD_REQUEST, errorCode);
        }
    }

    private static String clientIp(HttpServletRequest req) {
        if (req == null) return null;
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma > 0 ? xff.substring(0, comma) : xff).trim();
            if (!first.isEmpty()) return first;
        }
        return req.getRemoteAddr();
    }

    private static String safeUserAgent(HttpServletRequest req) {
        if (req == null) return null;
        String ua = req.getHeader("User-Agent");
        if (ua == null) return null;
        return ua.length() > 512 ? ua.substring(0, 512) : ua;
    }

    // ── DTOs ─────────────────────────────────────────────────────────────────

    public record OtpRequestBody(@NotBlank String mobile, String purpose) {
        public String purposeOrDefault() {
            if (purpose == null || purpose.isBlank()) return OtpRequest.PURPOSE_LOGIN;
            return switch (purpose.trim().toUpperCase(Locale.ROOT)) {
                case "LOGIN" -> OtpRequest.PURPOSE_LOGIN;
                case "REGISTER" -> OtpRequest.PURPOSE_REGISTER;
                case "PASSWORD_RESET" -> OtpRequest.PURPOSE_PASSWORD_RESET;
                default -> OtpRequest.PURPOSE_LOGIN;
            };
        }
    }

    public record OtpVerifyBody(@NotBlank String requestId, @NotBlank String otp) { }

    public record OtpResendBody(@NotBlank String requestId) { }
}
