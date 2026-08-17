package com.hrms.notification.msg91;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * MSG91 OTP send client.
 *
 * <p>Only the {@code POST /api/v5/otp} send endpoint is used — we NEVER call
 * {@code /api/v5/otp/verify} because we own the OTP value (generated with
 * {@code SecureRandom}, hashed with BCrypt into {@code auth.otp_requests})
 * so all verification is local and constant-time. MSG91 is a delivery pipe,
 * not the source of truth.
 *
 * <p>Retries: two additional attempts on 5xx / network with exponential
 * backoff (200 ms, 500 ms). 4xx is a permanent config error (bad template,
 * wrong sender, blocked number) — no retry, return the failure so ops can
 * see the alert instead of hiding it under a re-send storm.
 *
 * <p>Log hygiene: NEVER logs the OTP plaintext, hash, or salt. Correlation
 * id + last 4 digits of the mobile are the only PII in log lines.
 */
@Component
public class Msg91Client {

    private static final Logger log = LoggerFactory.getLogger(Msg91Client.class);

    /** Connect timeout — MSG91 is generally sub-100 ms; 3 s is generous. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);

    /** Read timeout — same story; 5 s covers the 99th percentile easily. */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(5);

    /** Total retry attempts INCLUDING the initial call. 3 = 1 + 2 retries. */
    private static final int MAX_ATTEMPTS = 3;

    /** Backoff sleep in millis, indexed by 0-based retry number. */
    private static final long[] BACKOFF_MS = { 200L, 500L };

    private final RestTemplate rest;

    private final String authKey;
    private final String templateId;
    private final String senderId;
    private final String route;
    private final String baseUrl;

    public Msg91Client(RestTemplateBuilder builder,
                       @Value("${msg91.auth-key:}") String authKey,
                       @Value("${msg91.template-id:}") String templateId,
                       @Value("${msg91.sender-id:}") String senderId,
                       @Value("${msg91.route:4}") String route,
                       @Value("${msg91.base-url:https://control.msg91.com}") String baseUrl) {
        this.rest = builder
                .setConnectTimeout(CONNECT_TIMEOUT)
                .setReadTimeout(READ_TIMEOUT)
                .build();
        this.authKey = authKey == null ? "" : authKey.trim();
        this.templateId = templateId == null ? "" : templateId.trim();
        this.senderId = senderId == null ? "" : senderId.trim();
        this.route = route == null ? "4" : route.trim();
        this.baseUrl = baseUrl == null ? "" : stripTrailingSlash(baseUrl.trim());
    }

    /**
     * Send an OTP via MSG91.
     *
     * @param phoneE164    caller number in E.164 (e.g. {@code +919876543210}).
     *                     Country code is required — the {@code +} is stripped
     *                     because MSG91's {@code mobile} query param wants the
     *                     raw digit string.
     * @param otp          the 6-digit code WE generated. Passed to MSG91 as
     *                     the {@code OTP} body field so the DLT template
     *                     ({@code ##OTP##} placeholder) renders it.
     * @param correlationId shared with {@code otp_requests.correlation_id} for
     *                     tracing the same OTP across request/verify/audit.
     * @return {@link Msg91SendResult} — always non-null; check {@link
     *         Msg91SendResult#success()} before using {@link
     *         Msg91SendResult#requestId()}.
     */
    public Msg91SendResult sendOtp(String phoneE164, String otp, UUID correlationId) {
        String mask = maskPhone(phoneE164);
        if (!isConfigured()) {
            log.error("MSG91 send skipped — client not fully configured (auth-key/template-id/sender-id). "
                    + "correlationId={} phone={}", correlationId, mask);
            return Msg91SendResult.failure("PROVIDER_NOT_CONFIGURED", 0);
        }
        if (phoneE164 == null || otp == null) {
            log.error("MSG91 send skipped — null phone/otp. correlationId={}", correlationId);
            return Msg91SendResult.failure("INVALID_ARGUMENT", 0);
        }

        // MSG91 wants {country-code}{10-digit-mobile}, no + or spaces.
        String mobile = phoneE164.replaceAll("\\D", "");
        String url = UriComponentsBuilder.fromHttpUrl(baseUrl + "/api/v5/otp")
                .queryParam("template_id", templateId)
                .queryParam("mobile", mobile)
                .queryParam("authkey", authKey)
                .build(true)
                .toUriString();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        // Auth-key also sent as a header — MSG91 accepts either; belt-and-braces
        // so a URL log-scrubber that strips query params still authenticates.
        headers.set("authkey", authKey);

        Map<String, Object> body = new HashMap<>();
        body.put("OTP", otp);
        if (!senderId.isBlank()) body.put("sender", senderId);
        if (!route.isBlank())    body.put("route", route);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                ResponseEntity<Map> resp = rest.postForEntity(url, entity, Map.class);
                Map<?, ?> respBody = resp.getBody();
                String requestId = extractRequestId(respBody);
                if (resp.getStatusCode().is2xxSuccessful() && isSuccessBody(respBody)) {
                    log.info("MSG91 OTP send OK correlationId={} phone={} attempt={} msg91RequestId={}",
                            correlationId, mask, attempt, requestId);
                    return Msg91SendResult.success(requestId, resp.getStatusCode().value());
                }
                // 2xx with non-success payload → treat as permanent failure.
                log.error("MSG91 OTP send returned non-success body correlationId={} phone={} status={} type={}",
                        correlationId, mask, resp.getStatusCode().value(), safeType(respBody));
                return Msg91SendResult.failure("PROVIDER_ERROR", resp.getStatusCode().value());

            } catch (HttpStatusCodeException httpEx) {
                HttpStatusCode sc = httpEx.getStatusCode();
                // 4xx: permanent (bad template, bad key, blocked number). No retry.
                if (sc.is4xxClientError()) {
                    log.error("MSG91 OTP send 4xx correlationId={} phone={} status={} (no retry)",
                            correlationId, mask, sc.value());
                    return Msg91SendResult.failure("PROVIDER_REJECTED", sc.value());
                }
                // 5xx: transient, retry if attempts left.
                log.warn("MSG91 OTP send 5xx correlationId={} phone={} status={} attempt={}",
                        correlationId, mask, sc.value(), attempt);
                if (attempt >= MAX_ATTEMPTS) {
                    return Msg91SendResult.failure("PROVIDER_UNAVAILABLE", sc.value());
                }
                sleepBackoff(attempt);
            } catch (ResourceAccessException netEx) {
                // Connect/read timeout / DNS / TLS. Retry.
                log.warn("MSG91 OTP send network error correlationId={} phone={} attempt={} err={}",
                        correlationId, mask, attempt, netEx.getMessage());
                if (attempt >= MAX_ATTEMPTS) {
                    return Msg91SendResult.failure("PROVIDER_UNREACHABLE", 0);
                }
                sleepBackoff(attempt);
            } catch (Exception ex) {
                // Unknown failure — do not retry an unknown state.
                log.error("MSG91 OTP send unexpected failure correlationId={} phone={} err={}",
                        correlationId, mask, ex.getMessage());
                return Msg91SendResult.failure("PROVIDER_ERROR", 0);
            }
        }
        // Fell through the retry loop without returning — shouldn't happen.
        return Msg91SendResult.failure("PROVIDER_UNAVAILABLE",
                HttpStatus.BAD_GATEWAY.value());
    }

    /** {@code true} iff auth-key, template-id and sender-id are all populated. */
    public boolean isConfigured() {
        return !authKey.isBlank() && !templateId.isBlank() && !senderId.isBlank();
    }

    private static void sleepBackoff(int attempt) {
        // attempt is 1-based; sleep before the NEXT attempt (index attempt-1).
        int idx = Math.min(attempt - 1, BACKOFF_MS.length - 1);
        try {
            Thread.sleep(BACKOFF_MS[idx]);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    private static String extractRequestId(Map<?, ?> body) {
        if (body == null) return null;
        Object v = body.get("request_id");
        if (v == null) v = body.get("requestId");
        return v == null ? null : v.toString();
    }

    private static boolean isSuccessBody(Map<?, ?> body) {
        if (body == null) return false;
        Object type = body.get("type");
        return type == null || "success".equalsIgnoreCase(type.toString());
    }

    private static String safeType(Map<?, ?> body) {
        if (body == null) return "null";
        Object t = body.get("type");
        return t == null ? "unknown" : t.toString();
    }

    /** Mask everything but the last four digits for log output. */
    private static String maskPhone(String phone) {
        if (phone == null) return "null";
        String digits = phone.replaceAll("\\D", "");
        if (digits.length() <= 4) return "****";
        return "******" + digits.substring(digits.length() - 4);
    }

    private static String stripTrailingSlash(String s) {
        if (s == null || s.isEmpty()) return s;
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    /**
     * Result of a send attempt.
     *
     * @param success   {@code true} iff MSG91 accepted the send
     * @param requestId MSG91's opaque request id — null on failure
     * @param errorCode short internal code on failure — null on success
     * @param httpStatus HTTP status code seen from MSG91 — 0 for network errors
     */
    public record Msg91SendResult(boolean success,
                                  String requestId,
                                  String errorCode,
                                  int httpStatus) {
        public static Msg91SendResult success(String requestId, int status) {
            return new Msg91SendResult(true, requestId, null, status);
        }
        public static Msg91SendResult failure(String errorCode, int status) {
            return new Msg91SendResult(false, null, errorCode, status);
        }
    }
}
