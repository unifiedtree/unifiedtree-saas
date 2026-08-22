package com.unifiedtree.saas.oauth;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginResponse;
import com.unifiedtree.saas.dto.AccountDtos.AccountSummary;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSummary;
import com.unifiedtree.saas.service.AccountService;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.dao.IncorrectResultSizeDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Google OAuth 2.0 Authorization-Code + PKCE flow for the /v1/accounts/auth
 * portal.
 *
 * <p>Auth ONLY: this service NEVER creates a workspace, NEVER mints a Razorpay
 * order and NEVER touches per-tenant data. On success it returns the exact
 * same {@link AccountLoginResponse} shape as
 * {@link AccountService#login(String, String)} and hands the caller a plain
 * refresh token string; the controller writes it into the shared
 * {@code ut_acct_rt} cookie exactly as the password path does.
 *
 * <p>Wiring:
 * <ul>
 *   <li>{@link #startAuthorizeUrl} generates state + PKCE verifier + nonce,
 *       inserts one row into {@code auth.oauth_state}, and returns the URL
 *       plus the opaque state UUID the caller pins into a short-lived
 *       {@code ut_oauth_state} cookie.</li>
 *   <li>{@link #completeCallback} verifies the state cookie, DELETEs the state
 *       row (single-use), exchanges the code with Google, verifies the RS256
 *       ID token against the cached JWKS, resolves-or-creates the account
 *       and returns the login response.</li>
 * </ul>
 */
@Service
public class GoogleOauthService {

    private static final Logger log = LoggerFactory.getLogger(GoogleOauthService.class);

    private static final String GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
    private static final List<String> ACCEPTED_ISSUERS = List.of(
            "https://accounts.google.com",
            "accounts.google.com");

    /** Absolute max clock skew we tolerate on iat / exp — Google itself is tight. */
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(5);

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final SecureRandom RNG = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final JwtService jwt;
    private final AccountService accounts;

    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;
    private final String webBaseUrl;
    private final Duration stateTtl;
    private final Duration jwksCacheTtl;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    /** In-JVM JWKS cache with a strict TTL. Not per-request. */
    private final AtomicReference<CachedJwks> jwksCache = new AtomicReference<>();

    public GoogleOauthService(JdbcTemplate jdbc,
                              JwtService jwt,
                              AccountService accounts,
                              @Value("${unifiedtree.oauth.google.client-id:}") String clientId,
                              @Value("${unifiedtree.oauth.google.client-secret:}") String clientSecret,
                              @Value("${unifiedtree.oauth.google.redirect-uri:https://api.unifiedtree.com/api/v1/accounts/auth/google/callback}") String redirectUri,
                              @Value("${unifiedtree.oauth.google.web-base-url:https://www.unifiedtree.com}") String webBaseUrl,
                              @Value("${unifiedtree.oauth.google.state-ttl-seconds:900}") long stateTtlSeconds,
                              @Value("${unifiedtree.oauth.google.jwks-cache-ttl-hours:24}") long jwksCacheTtlHours) {
        this.jdbc = jdbc;
        this.jwt = jwt;
        this.accounts = accounts;
        this.clientId = clientId == null ? "" : clientId.trim();
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
        this.redirectUri = redirectUri;
        this.webBaseUrl = trimTrailingSlash(webBaseUrl);
        this.stateTtl = Duration.ofSeconds(stateTtlSeconds);
        this.jwksCacheTtl = Duration.ofHours(jwksCacheTtlHours);
    }

    @PostConstruct
    void warn() {
        if (!isConfigured()) {
            log.warn("Google OAuth is DISABLED: unifiedtree.oauth.google.client-id or client-secret is missing. "
                    + "/v1/accounts/auth/google/start will return 503 until both are populated.");
        }
    }

    public boolean isConfigured() {
        return !clientId.isEmpty() && !clientSecret.isEmpty();
    }

    public String webBaseUrl() {
        return webBaseUrl;
    }

    // ── /start ──────────────────────────────────────────────────────────────

    /**
     * Insert one {@code auth.oauth_state} row and build the Google authorize
     * URL. Returns the opaque state UUID — the caller writes it into the
     * short-lived {@code ut_oauth_state} cookie so /callback can defeat state
     * fixation by requiring both to match.
     */
    public AuthorizeStart startAuthorizeUrl(String returnTo,
                                            String prompt,
                                            String requestIp,
                                            String userAgent) {
        if (!isConfigured()) {
            throw new OauthUnavailableException("oauth_unavailable");
        }
        String safeReturnTo = sanitizeReturnTo(returnTo);
        String codeVerifier = randomBase64Url(32);
        String codeChallenge = base64UrlSha256(codeVerifier);
        String nonce = randomBase64Url(32);
        UUID state = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();

        // Opportunistic sweep of expired rows. Cheap because of idx_oauth_state_expiry.
        jdbc.update("DELETE FROM auth.oauth_state WHERE expires_at < now()");

        jdbc.update("""
                INSERT INTO auth.oauth_state
                    (state_token, provider, code_verifier, nonce, return_to, request_ip, user_agent, expires_at)
                VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
                """,
                state, codeVerifier, nonce, safeReturnTo,
                truncate(requestIp, 64), truncate(userAgent, 512),
                now.plus(stateTtl));

        StringBuilder url = new StringBuilder(GOOGLE_AUTHORIZE_URL).append('?')
                .append("client_id=").append(urlEncode(clientId))
                .append("&redirect_uri=").append(urlEncode(redirectUri))
                .append("&response_type=code")
                .append("&scope=").append(urlEncode("openid email profile"))
                .append("&access_type=online")
                .append("&include_granted_scopes=true")
                .append("&state=").append(state)
                .append("&code_challenge=").append(codeChallenge)
                .append("&code_challenge_method=S256")
                .append("&nonce=").append(urlEncode(nonce));
        String cleanPrompt = normalizePrompt(prompt);
        if (cleanPrompt != null) url.append("&prompt=").append(urlEncode(cleanPrompt));
        return new AuthorizeStart(url.toString(), state);
    }

    // ── /callback ───────────────────────────────────────────────────────────

    /**
     * Full callback pipeline. Throws {@link OauthCallbackException} whose
     * {@link OauthCallbackException#errorCode} is what the controller pastes
     * into {@code /login?error=<code>}. Returns:
     * <ul>
     *   <li>{@link CallbackResult#loginResponse} — the exact
     *       {@link AccountLoginResponse} shape the password login returns;
     *       the {@code accessToken} is the one baked into
     *       {@code Set-Cookie: ut_acct_rt} on that same response, and the
     *       front end pulls it via {@code /v1/accounts/auth/refresh}.</li>
     *   <li>{@link CallbackResult#refreshToken} — plaintext for the caller
     *       to write into the {@code ut_acct_rt} cookie exactly as
     *       {@code AccountController.login} does.</li>
     *   <li>{@link CallbackResult#returnTo} — sanitized relative path from
     *       the state row.</li>
     * </ul>
     */
    public CallbackResult completeCallback(String stateFromQuery,
                                           String stateFromCookie,
                                           String code,
                                           String googleError,
                                           String requestIp,
                                           String userAgent) {
        if (!isConfigured()) {
            throw new OauthCallbackException("oauth_unavailable", null);
        }
        if (googleError != null && !googleError.isBlank()) {
            // access_denied is the user cancelling at the consent screen.
            // Consume the state row (still dead weight for ttl otherwise).
            consumeStateIfPresent(stateFromQuery);
            String code2 = "access_denied".equalsIgnoreCase(googleError) ? "oauth_cancelled" : "oauth_google_error";
            throw new OauthCallbackException(code2, stateReturnTo(stateFromQuery));
        }
        if (stateFromCookie == null || stateFromCookie.isBlank()
                || stateFromQuery == null || stateFromQuery.isBlank()) {
            throw new OauthCallbackException("oauth_state_lost", null);
        }
        if (!constantTimeEquals(stateFromCookie, stateFromQuery)) {
            log.warn("oauth callback state mismatch cookie={} query={}",
                    truncateForLog(stateFromCookie), truncateForLog(stateFromQuery));
            throw new OauthCallbackException("oauth_state_mismatch", null);
        }

        OauthStateRow row = consumeStateOrThrow(stateFromQuery);
        if (row.expiresAt().isBefore(OffsetDateTime.now())) {
            throw new OauthCallbackException("oauth_state_lost", row.returnTo());
        }
        if (code == null || code.isBlank()) {
            throw new OauthCallbackException("oauth_google_error", row.returnTo());
        }

        Map<String, Object> tokenResp = exchangeCode(code, row.codeVerifier(), row.returnTo());
        String idToken = String.valueOf(tokenResp.get("id_token"));
        if (idToken == null || "null".equals(idToken) || idToken.isBlank()) {
            log.warn("google token exchange returned no id_token: {}", scrub(tokenResp));
            throw new OauthCallbackException("oauth_id_token_invalid", row.returnTo());
        }

        GoogleIdClaims claims = verifyIdToken(idToken, row.nonce(), row.returnTo());

        ResolvedAccount resolved = resolveAccount(claims, requestIp, userAgent, row.returnTo());

        AccountLoginResponse response = accounts.buildLoginResponseAfterOauth(resolved.accountId());
        String plainRefresh = accounts.issueRefresh(resolved.accountId(), userAgent, requestIp);
        return new CallbackResult(response, plainRefresh, row.returnTo());
    }

    // ── state row helpers ───────────────────────────────────────────────────

    /**
     * SELECT + DELETE a state row atomically. Single-use — a second callback
     * with the same state finds nothing and the caller redirects with
     * oauth_state_lost. Uses DELETE ... RETURNING which is atomic in Postgres.
     */
    @Transactional
    protected OauthStateRow consumeStateOrThrow(String stateToken) {
        UUID stateUuid;
        try {
            stateUuid = UUID.fromString(stateToken);
        } catch (IllegalArgumentException e) {
            throw new OauthCallbackException("oauth_state_lost", null);
        }
        try {
            return jdbc.queryForObject("""
                    DELETE FROM auth.oauth_state
                     WHERE state_token = ?
                    RETURNING state_token, code_verifier, nonce, return_to, expires_at
                    """, (rs, i) -> new OauthStateRow(
                    UUID.fromString(rs.getString("state_token")),
                    rs.getString("code_verifier"),
                    rs.getString("nonce"),
                    rs.getString("return_to"),
                    rs.getObject("expires_at", OffsetDateTime.class)),
                    stateUuid);
        } catch (EmptyResultDataAccessException e) {
            throw new OauthCallbackException("oauth_state_lost", null);
        }
    }

    /** Best-effort clean-up when we bail before consumeStateOrThrow — never throws. */
    private void consumeStateIfPresent(String stateToken) {
        if (stateToken == null || stateToken.isBlank()) return;
        try {
            UUID stateUuid = UUID.fromString(stateToken);
            jdbc.update("DELETE FROM auth.oauth_state WHERE state_token = ?", stateUuid);
        } catch (RuntimeException ignored) {
            // Best-effort — the row expires in 10 min anyway.
        }
    }

    /** Peek at the state row's return_to without consuming it. Best-effort. */
    private String stateReturnTo(String stateToken) {
        if (stateToken == null || stateToken.isBlank()) return null;
        try {
            UUID stateUuid = UUID.fromString(stateToken);
            return jdbc.queryForObject(
                    "SELECT return_to FROM auth.oauth_state WHERE state_token = ?",
                    String.class, stateUuid);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    // ── token exchange ──────────────────────────────────────────────────────

    private Map<String, Object> exchangeCode(String code, String codeVerifier, String returnTo) {
        String form = "grant_type=authorization_code"
                + "&code=" + urlEncode(code)
                + "&redirect_uri=" + urlEncode(redirectUri)
                + "&client_id=" + urlEncode(clientId)
                + "&client_secret=" + urlEncode(clientSecret)
                + "&code_verifier=" + urlEncode(codeVerifier);
        HttpRequest req = HttpRequest.newBuilder(URI.create(GOOGLE_TOKEN_URL))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(form, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception e) {
            log.warn("google token exchange failed to send: {}", e.toString());
            throw new OauthCallbackException("oauth_unavailable", returnTo);
        }
        if (resp.statusCode() / 100 != 2) {
            log.warn("google token exchange returned {}: {}", resp.statusCode(), scrubBody(resp.body()));
            throw new OauthCallbackException("oauth_google_error", returnTo);
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = OBJECT_MAPPER.readValue(resp.body(), Map.class);
            return parsed == null ? Map.of() : parsed;
        } catch (Exception e) {
            log.warn("google token response was not JSON: {}", e.toString());
            throw new OauthCallbackException("oauth_google_error", returnTo);
        }
    }

    // ── id-token verification ───────────────────────────────────────────────

    private GoogleIdClaims verifyIdToken(String idToken, String expectedNonce, String returnTo) {
        SignedJWT signed;
        try {
            signed = SignedJWT.parse(idToken);
        } catch (Exception e) {
            log.warn("id_token parse failed: {}", e.toString());
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        if (!JWSAlgorithm.RS256.equals(signed.getHeader().getAlgorithm())) {
            log.warn("id_token rejected: alg={}", signed.getHeader().getAlgorithm());
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        String kid = signed.getHeader().getKeyID();
        RSAKey rsaKey = findKey(kid, false, returnTo);
        JWTClaimsSet claims;
        try {
            JWSVerifier verifier = new RSASSAVerifier(rsaKey.toRSAPublicKey());
            if (!signed.verify(verifier)) {
                // The kid could have rotated between cache and now — refresh once.
                rsaKey = findKey(kid, true, returnTo);
                verifier = new RSASSAVerifier(rsaKey.toRSAPublicKey());
                if (!signed.verify(verifier)) {
                    log.warn("id_token signature verification failed for kid={}", kid);
                    throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
                }
            }
            claims = signed.getJWTClaimsSet();
        } catch (OauthCallbackException e) {
            throw e;
        } catch (Exception e) {
            log.warn("id_token signature check errored: {}", e.toString());
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }

        // Issuer
        String iss = claims.getIssuer();
        if (iss == null || !ACCEPTED_ISSUERS.contains(iss)) {
            log.warn("id_token rejected: iss={}", iss);
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        // Audience — must be exact client id, single string. Reject any array
        // with extra values.
        List<String> aud = claims.getAudience();
        if (aud == null || aud.size() != 1 || !clientId.equals(aud.get(0))) {
            log.warn("id_token rejected: aud={}", aud);
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        // Expiry
        java.util.Date exp = claims.getExpirationTime();
        long nowMs = System.currentTimeMillis();
        if (exp == null || exp.getTime() + CLOCK_SKEW.toMillis() < nowMs) {
            log.warn("id_token rejected: expired at {}", exp);
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        // iat sanity — must not be from the future by more than skew.
        java.util.Date iat = claims.getIssueTime();
        if (iat != null && iat.getTime() - CLOCK_SKEW.toMillis() > nowMs) {
            log.warn("id_token rejected: iat in future {}", iat);
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        // Nonce
        Object nonceClaim = claims.getClaim("nonce");
        if (nonceClaim == null || !constantTimeEquals(String.valueOf(nonceClaim), expectedNonce)) {
            log.warn("id_token rejected: nonce mismatch");
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }

        String sub = claims.getSubject();
        String email = stringClaim(claims, "email");
        Boolean emailVerified = booleanClaim(claims, "email_verified");
        String name = stringClaim(claims, "name");
        String givenName = stringClaim(claims, "given_name");
        String familyName = stringClaim(claims, "family_name");
        String picture = stringClaim(claims, "picture");

        if (sub == null || sub.isBlank() || email == null || email.isBlank()) {
            log.warn("id_token rejected: missing sub or email");
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        if (!Boolean.TRUE.equals(emailVerified)) {
            log.info("id_token has email_verified=false, refusing sign-in for {}", email);
            throw new OauthCallbackException("oauth_email_unverified", returnTo);
        }
        return new GoogleIdClaims(sub, email.toLowerCase(Locale.ROOT), name, givenName, familyName, picture);
    }

    /** Find a JWK by kid, using the cache. When {@code forceRefresh} is true, ignore any cached copy. */
    private RSAKey findKey(String kid, boolean forceRefresh, String returnTo) {
        JWKSet set = forceRefresh ? null : cachedJwks();
        if (set != null) {
            JWK jwk = kid == null ? null : set.getKeyByKeyId(kid);
            if (jwk instanceof RSAKey rsa) return rsa;
        }
        JWKSet fresh = fetchJwks(returnTo);
        JWK jwk = kid == null ? null : fresh.getKeyByKeyId(kid);
        if (!(jwk instanceof RSAKey rsa)) {
            log.warn("id_token kid {} not found in Google JWKS", kid);
            throw new OauthCallbackException("oauth_id_token_invalid", returnTo);
        }
        return rsa;
    }

    private JWKSet cachedJwks() {
        CachedJwks c = jwksCache.get();
        if (c == null) return null;
        if (c.fetchedAtMs() + jwksCacheTtl.toMillis() < System.currentTimeMillis()) return null;
        return c.set();
    }

    private JWKSet fetchJwks(String returnTo) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(GOOGLE_JWKS_URL))
                .timeout(Duration.ofSeconds(5))
                .header("Accept", "application/json")
                .GET().build();
        Exception last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (resp.statusCode() / 100 == 2) {
                    JWKSet parsed = JWKSet.parse(resp.body());
                    jwksCache.set(new CachedJwks(parsed, System.currentTimeMillis()));
                    return parsed;
                }
                last = new IllegalStateException("HTTP " + resp.statusCode());
            } catch (Exception e) {
                last = e;
            }
        }
        // Fall back to any stale cached copy so a transient Google outage does
        // not lock everyone out.
        CachedJwks stale = jwksCache.get();
        if (stale != null) {
            log.warn("google JWKS fetch failed, serving stale cache: {}", last == null ? "?" : last.toString());
            return stale.set();
        }
        log.warn("google JWKS fetch failed and no cache present: {}", last == null ? "?" : last.toString());
        throw new OauthCallbackException("oauth_unavailable", returnTo);
    }

    // ── account resolve / auto-link / auto-signup ───────────────────────────

    /**
     * Find-or-create the platform.accounts row. Single @Transactional method
     * so the SELECT-by-sub, SELECT-by-email, INSERT and last_login_at UPDATE
     * all commit atomically — no TOCTOU window where a concurrent callback
     * could double-insert.
     */
    @Transactional
    protected ResolvedAccount resolveAccount(GoogleIdClaims claims,
                                             String requestIp,
                                             String userAgent,
                                             String returnTo) {
        // 1. Match by google_sub — the strongest binding. Trust the sub even
        //    if the email claim changed since last login.
        UUID bySub = findAccountIdByGoogleSub(claims.sub());
        if (bySub != null) {
            try {
                jdbc.update("""
                        UPDATE platform.accounts
                           SET email = ?,
                               email_verified = TRUE,
                               google_avatar_url = COALESCE(?, google_avatar_url),
                               given_name  = COALESCE(?, given_name),
                               family_name = COALESCE(?, family_name),
                               failed_login_count = 0,
                               locked_until = NULL,
                               last_login_at = now(),
                               updated_at = now()
                         WHERE id = ?
                        """,
                        claims.email(),
                        claims.picture(),
                        claims.givenName(),
                        claims.familyName(),
                        bySub);
            } catch (org.springframework.dao.DuplicateKeyException dke) {
                // Another platform.accounts row already owns this email
                // (password-only, no google_sub). Human intervention needed.
                log.error("oauth_email_collision on google_sub match: sub={} email={} accountId={}",
                        claims.sub(), claims.email(), bySub);
                throw new OauthCallbackException("oauth_email_collision", returnTo);
            }
            assertActive(bySub, returnTo);
            return new ResolvedAccount(bySub, false);
        }

        // 2. Match by email — this is the "password-only user first-time Google"
        //    auto-link path. Google email is verified so no additional wall.
        UUID byEmail;
        try {
            byEmail = findAccountIdByEmail(claims.email());
        } catch (IncorrectResultSizeDataAccessException e) {
            log.error("oauth_email_collision by email: {} rows for {}", e.getActualSize(), claims.email());
            throw new OauthCallbackException("oauth_email_collision", returnTo);
        }
        if (byEmail != null) {
            try {
                jdbc.update("""
                        UPDATE platform.accounts
                           SET google_sub = ?,
                               google_avatar_url = COALESCE(google_avatar_url, ?),
                               given_name  = COALESCE(given_name, ?),
                               family_name = COALESCE(family_name, ?),
                               email_verified = TRUE,
                               failed_login_count = 0,
                               locked_until = NULL,
                               last_login_at = now(),
                               updated_at = now()
                         WHERE id = ?
                        """,
                        claims.sub(),
                        claims.picture(),
                        claims.givenName(),
                        claims.familyName(),
                        byEmail);
            } catch (org.springframework.dao.DuplicateKeyException dke) {
                log.error("oauth_email_collision on auto-link: sub={} email={}", claims.sub(), claims.email());
                throw new OauthCallbackException("oauth_email_collision", returnTo);
            }
            assertActive(byEmail, returnTo);
            return new ResolvedAccount(byEmail, false);
        }

        // 3. Auto-create.
        UUID newId = UUID.randomUUID();
        String displayName = deriveDisplayName(claims);
        // ON CONFLICT DO NOTHING defends against a double-click race where two
        // callbacks resolve the same brand-new email concurrently. If we lose
        // the insert we re-select and use the winner.
        int inserted = jdbc.update("""
                INSERT INTO platform.accounts
                    (id, email, display_name, phone, password_hash, status,
                     google_sub, google_avatar_url, given_name, family_name,
                     email_verified, failed_login_count, last_login_at,
                     created_at, updated_at)
                VALUES (?, ?, ?, NULL, NULL, 'ACTIVE',
                        ?, ?, ?, ?, TRUE, 0, now(), now(), now())
                ON CONFLICT DO NOTHING
                """,
                newId, claims.email(), displayName,
                claims.sub(), claims.picture(), claims.givenName(), claims.familyName());
        if (inserted == 0) {
            // Someone else won. Fold onto their row via the sub match (if the
            // race also raced past our sub check).
            UUID winner = findAccountIdByGoogleSub(claims.sub());
            if (winner == null) {
                try {
                    winner = findAccountIdByEmail(claims.email());
                } catch (IncorrectResultSizeDataAccessException e) {
                    throw new OauthCallbackException("oauth_email_collision", returnTo);
                }
            }
            if (winner == null) {
                log.error("oauth_email_collision: insert lost and no row to fall back to for email={}", claims.email());
                throw new OauthCallbackException("oauth_email_collision", returnTo);
            }
            assertActive(winner, returnTo);
            return new ResolvedAccount(winner, false);
        }
        return new ResolvedAccount(newId, true);
    }

    private UUID findAccountIdByGoogleSub(String sub) {
        try {
            return jdbc.queryForObject(
                    "SELECT id FROM platform.accounts WHERE google_sub = ?",
                    (rs, i) -> UUID.fromString(rs.getString("id")), sub);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private UUID findAccountIdByEmail(String email) {
        try {
            return jdbc.queryForObject(
                    "SELECT id FROM platform.accounts WHERE lower(email) = lower(?)",
                    (rs, i) -> UUID.fromString(rs.getString("id")), email);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private void assertActive(UUID accountId, String returnTo) {
        String status = jdbc.queryForObject(
                "SELECT status::text FROM platform.accounts WHERE id = ?",
                String.class, accountId);
        if (!"ACTIVE".equals(status)) {
            throw new OauthCallbackException("oauth_account_disabled", returnTo);
        }
    }

    private static String deriveDisplayName(GoogleIdClaims claims) {
        if (claims.name() != null && !claims.name().isBlank()) return truncate(claims.name(), 150);
        String joined = null;
        if (claims.givenName() != null || claims.familyName() != null) {
            joined = ((claims.givenName() == null ? "" : claims.givenName()) + " "
                    + (claims.familyName() == null ? "" : claims.familyName())).trim();
        }
        if (joined != null && !joined.isBlank()) return truncate(joined, 150);
        String email = claims.email();
        int at = email.indexOf('@');
        String local = at > 0 ? email.substring(0, at) : email;
        return truncate(local, 150);
    }

    // ── utility ─────────────────────────────────────────────────────────────

    /**
     * Whitelisted-return-to check. Must start with '/', not be a
     * protocol-relative URL ('//host…'), not contain a scheme, and fit 128
     * chars. Anything else is coerced to '/workspaces'.
     */
    static String sanitizeReturnTo(String candidate) {
        if (candidate == null) return "/workspaces";
        String t = candidate.trim();
        if (t.isEmpty()) return "/workspaces";
        if (t.length() > 128) return "/workspaces";
        if (!t.startsWith("/")) return "/workspaces";
        if (t.startsWith("//")) return "/workspaces";
        if (t.startsWith("/\\")) return "/workspaces";
        if (t.contains(":")) return "/workspaces";
        return t;
    }

    private static String normalizePrompt(String prompt) {
        if (prompt == null) return null;
        String t = prompt.trim().toLowerCase(Locale.ROOT);
        if ("select_account".equals(t) || "consent".equals(t)) return t;
        return null;
    }

    private static String randomBase64Url(int byteLen) {
        byte[] buf = new byte[byteLen];
        RNG.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    private static String base64UrlSha256(String verifier) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(ab, bb);
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String truncateForLog(String s) {
        if (s == null) return "null";
        return s.length() <= 8 ? s : (s.substring(0, 4) + "…" + s.substring(s.length() - 4));
    }

    private static String trimTrailingSlash(String s) {
        if (s == null || s.isEmpty()) return "";
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    private static String stringClaim(JWTClaimsSet claims, String name) {
        try {
            return claims.getStringClaim(name);
        } catch (Exception e) {
            Object o = claims.getClaim(name);
            return o == null ? null : String.valueOf(o);
        }
    }

    private static Boolean booleanClaim(JWTClaimsSet claims, String name) {
        try {
            return claims.getBooleanClaim(name);
        } catch (Exception e) {
            Object o = claims.getClaim(name);
            if (o instanceof Boolean b) return b;
            if (o instanceof String s) return Boolean.parseBoolean(s);
            return null;
        }
    }

    /** Scrub the token-exchange response before logging — never leak client_secret / tokens. */
    private static String scrub(Map<String, Object> m) {
        if (m == null) return "{}";
        StringBuilder sb = new StringBuilder("{");
        for (Map.Entry<String, Object> e : m.entrySet()) {
            String k = e.getKey();
            if ("id_token".equals(k) || "access_token".equals(k) || "refresh_token".equals(k)) continue;
            if (sb.length() > 1) sb.append(", ");
            sb.append(k).append('=').append(e.getValue());
        }
        return sb.append('}').toString();
    }

    private static String scrubBody(String body) {
        if (body == null) return "";
        return body.length() > 240 ? body.substring(0, 240) + "…" : body;
    }

    // ── records + exception types ───────────────────────────────────────────

    public record AuthorizeStart(String authorizeUrl, UUID stateToken) {}

    public record CallbackResult(AccountLoginResponse loginResponse,
                                 String refreshToken,
                                 String returnTo) {}

    private record OauthStateRow(UUID stateToken,
                                 String codeVerifier,
                                 String nonce,
                                 String returnTo,
                                 OffsetDateTime expiresAt) {}

    private record GoogleIdClaims(String sub,
                                  String email,
                                  String name,
                                  String givenName,
                                  String familyName,
                                  String picture) {}

    private record ResolvedAccount(UUID accountId, boolean created) {}

    private record CachedJwks(JWKSet set, long fetchedAtMs) {}

    /** Fatal, controller redirects to /login?error=<code>. */
    public static class OauthCallbackException extends RuntimeException {
        private final String errorCode;
        private final String returnTo;
        public OauthCallbackException(String errorCode, String returnTo) {
            super(errorCode);
            this.errorCode = errorCode;
            this.returnTo = returnTo;
        }
        public String errorCode() { return errorCode; }
        public String returnTo() { return returnTo; }
    }

    /** /start-side "secrets missing" — controller returns 503. */
    public static class OauthUnavailableException extends RuntimeException {
        public OauthUnavailableException(String message) { super(message); }
    }

    // Also unused for the caller — kept package-visible for the controller.
    /** Marker: AccountSummary/WorkspaceSummary shape used in callback JSON. */
    @SuppressWarnings("unused")
    private static final Class<?> UNUSED_TYPE_REF_SUMMARY = AccountSummary.class;
    @SuppressWarnings("unused")
    private static final Class<?> UNUSED_TYPE_REF_WORKSPACE = WorkspaceSummary.class;
}
