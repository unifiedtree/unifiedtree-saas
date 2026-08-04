package com.unifiedtree.saas.payment;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Razorpay credentials + toggles, sourced from the environment (never
 * hardcoded, never committed). On Cloud Run these come from Secret Manager:
 *   RAZORPAY_KEY_ID         -> unifiedtree.razorpay.key-id
 *   RAZORPAY_KEY_SECRET     -> unifiedtree.razorpay.key-secret
 *   RAZORPAY_WEBHOOK_SECRET -> unifiedtree.razorpay.webhook-secret
 *
 * <p>{@code enabled} lets us hard-disable the paywall (e.g. local dev) so
 * signup falls back to the free path. In production it must be true.
 *
 * <p>The webhook secret is separate from the key secret — Razorpay uses it
 * to sign webhook payloads (HMAC-SHA256 over the raw body, delivered in
 * the X-Razorpay-Signature header). It is set in the Razorpay dashboard
 * when adding the webhook endpoint, and MUST be verified on every event
 * before we touch our ledger.
 */
@Component
public class RazorpayProperties {

    private final String keyId;
    private final String keySecret;
    private final String webhookSecret;
    private final boolean enabled;
    private final String apiBase;

    public RazorpayProperties(
            @Value("${unifiedtree.razorpay.key-id:${RAZORPAY_KEY_ID:}}") String keyId,
            @Value("${unifiedtree.razorpay.key-secret:${RAZORPAY_KEY_SECRET:}}") String keySecret,
            @Value("${unifiedtree.razorpay.webhook-secret:${RAZORPAY_WEBHOOK_SECRET:}}") String webhookSecret,
            @Value("${unifiedtree.razorpay.enabled:true}") boolean enabled,
            @Value("${unifiedtree.razorpay.api-base:https://api.razorpay.com/v1}") String apiBase) {
        this.keyId = keyId == null ? "" : keyId.trim();
        this.keySecret = keySecret == null ? "" : keySecret.trim();
        this.webhookSecret = webhookSecret == null ? "" : webhookSecret.trim();
        this.enabled = enabled;
        this.apiBase = apiBase;
    }

    public String keyId() { return keyId; }
    public String keySecret() { return keySecret; }
    public String webhookSecret() { return webhookSecret; }
    public String apiBase() { return apiBase; }

    /** Webhook handling only works once the shared secret is present. */
    public boolean isWebhookConfigured() {
        return !webhookSecret.isBlank();
    }

    /**
     * Paywall is active only when explicitly enabled AND both keys are present.
     * If keys are missing we treat the gateway as OFF rather than 500-ing every
     * checkout — the caller decides whether to allow a free signup.
     */
    public boolean isConfigured() {
        return enabled && !keyId.isBlank() && !keySecret.isBlank();
    }

    /** True for a Razorpay LIVE key (real money). Used only for logging/guards. */
    public boolean isLive() {
        return keyId.startsWith("rzp_live_");
    }
}
