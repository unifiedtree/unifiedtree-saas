package com.unifiedtree.auth.ratelimit;

import com.hrms.core.exception.HrmsException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * In-memory sliding-window rate limiter for public (unauthenticated) endpoints
 * that are prime enumeration / brute-force / cost-abuse targets.
 *
 * <p>Bundle B4 — public endpoint hardening. Wired into:
 * <ul>
 *   <li>{@code POST /v1/public/free-signup}</li>
 *   <li>{@code POST /v1/public/subscription-signup}</li>
 *   <li>{@code POST /v1/public/module-request}</li>
 *   <li>{@code POST /v1/accounts/auth/login}</li>
 * </ul>
 *
 * <p>Two independent windows per call:
 * <ul>
 *   <li>{@code (endpoint + email)} — 5 requests / 15 min. Blocks credential
 *       stuffing and repeat-signup abuse targeted at a single account.</li>
 *   <li>{@code (endpoint + ip)}    — 20 requests / 15 min. Blocks a single
 *       source pounding the endpoint across many emails.</li>
 * </ul>
 *
 * <p>Deliberately per-instance and in-process:
 * <ul>
 *   <li>Stops the noisy 90% of scripted attacks at zero infra cost.</li>
 *   <li>The DB-level failed_login_count + platform.pending_signups checks
 *       already provide defence-in-depth for the coordinated case.</li>
 *   <li>Same tradeoff every other single-node limiter in this codebase
 *       (LoginRateLimiter, invite resend, password reset) takes.</li>
 * </ul>
 *
 * <p>Housekeeping: a lightweight scheduled sweep evicts empty entries once a
 * minute so the map cannot grow unbounded under low-and-slow probes.
 */
@Component
public class PublicEndpointRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(PublicEndpointRateLimiter.class);

    /** Sliding-window length shared by both keys. */
    static final Duration WINDOW = Duration.ofMinutes(15);

    /** Threshold on the (endpoint + email) key. */
    static final int MAX_PER_EMAIL = 5;

    /** Threshold on the (endpoint + ip) key. */
    static final int MAX_PER_IP = 20;

    /** Millisecond timestamps of recent hits per composite key. */
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    /** Sweeps out empty entries periodically so the map cannot grow forever. */
    private ScheduledExecutorService sweeper;

    @PostConstruct
    void start() {
        sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "public-rate-limit-sweeper");
            t.setDaemon(true);
            return t;
        });
        // Every minute is plenty; the check-time purge does the work under load.
        sweeper.scheduleAtFixedRate(this::evictEmpty, 1, 1, TimeUnit.MINUTES);
    }

    @PreDestroy
    void stop() {
        if (sweeper != null) sweeper.shutdownNow();
    }

    /**
     * Enforce the per-email AND per-ip limits for {@code endpoint}. Records
     * this hit if allowed. Throws {@link HrmsException} with
     * {@code TOO_MANY_REQUESTS / RATE_LIMITED} if either key is exhausted.
     *
     * @param endpoint short label of the endpoint being called (e.g.
     *                 {@code "free-signup"}); joined into both keys so the
     *                 limits are scoped per-endpoint, not global.
     * @param ip       remote IP of the caller. Null / blank skips the IP key.
     * @param email    caller-supplied email. Null / blank skips the email key.
     */
    public void check(String endpoint, String ip, String email) {
        long now = System.currentTimeMillis();
        String emailKey = compositeEmailKey(endpoint, email);
        String ipKey    = compositeIpKey(endpoint, ip);

        if (emailKey != null && exceeds(emailKey, MAX_PER_EMAIL, now)) {
            log.warn("public-rate-limit tripped by email endpoint={} email={} ",
                    endpoint, normalise(email));
            throw new HrmsException(
                    "Too many requests. Please try again in a few minutes.",
                    HttpStatus.TOO_MANY_REQUESTS,
                    "RATE_LIMITED");
        }
        if (ipKey != null && exceeds(ipKey, MAX_PER_IP, now)) {
            log.warn("public-rate-limit tripped by ip endpoint={} ip={}",
                    endpoint, ip);
            throw new HrmsException(
                    "Too many requests. Please try again in a few minutes.",
                    HttpStatus.TOO_MANY_REQUESTS,
                    "RATE_LIMITED");
        }
        // Passed both gates — record the hit on each key we tracked.
        if (emailKey != null) record(emailKey, now);
        if (ipKey    != null) record(ipKey, now);
    }

    /**
     * IP-only variant with an explicit per-minute cap. Used by refresh-style
     * endpoints where the caller-supplied identity (email) is not known at
     * request time — the credential is an opaque cookie/body token, so the
     * (endpoint + email) key is meaningless and we fall back to (endpoint + ip).
     *
     * <p>Window is hard-wired to 1 minute so {@code limit} maps directly to
     * "N per minute per IP" — 60 for account refresh is a healthy budget for
     * "browser fires refresh from N tabs on wake" while still stopping a
     * runaway loop.
     */
    public void checkPerIp(String endpoint, String ip, int limit) {
        long now = System.currentTimeMillis();
        String ipKey = compositeIpKey(endpoint, ip);
        if (ipKey == null) return;  // unknown IP → skip the gate rather than 429ing every caller
        long cutoff = now - Duration.ofMinutes(1).toMillis();

        Deque<Long> stamps = hits.computeIfAbsent(ipKey, k -> new ArrayDeque<>());
        synchronized (stamps) {
            // Purge only entries older than the 1-minute per-IP window.
            // (purgeExpired uses the shared 15-minute WINDOW and would leave
            // stale hits in place, incorrectly tripping the limiter.)
            Iterator<Long> it = stamps.iterator();
            while (it.hasNext()) {
                if (it.next() < cutoff) it.remove();
                else break;
            }
            if (stamps.size() >= limit) {
                log.warn("public-rate-limit tripped by ip (per-minute) endpoint={} ip={} limit={}",
                        endpoint, ip, limit);
                throw new HrmsException(
                        "Too many requests. Please try again in a moment.",
                        HttpStatus.TOO_MANY_REQUESTS,
                        "RATE_LIMITED");
            }
            stamps.addLast(now);
        }
    }

    // ── internals ─────────────────────────────────────────────────────────────

    private boolean exceeds(String key, int limit, long now) {
        Deque<Long> stamps = hits.get(key);
        if (stamps == null) return false;
        synchronized (stamps) {
            purgeExpired(stamps, now);
            return stamps.size() >= limit;
        }
    }

    private void record(String key, long now) {
        Deque<Long> stamps = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (stamps) {
            purgeExpired(stamps, now);
            stamps.addLast(now);
        }
    }

    private static void purgeExpired(Deque<Long> stamps, long now) {
        long cutoff = now - WINDOW.toMillis();
        Iterator<Long> it = stamps.iterator();
        while (it.hasNext()) {
            if (it.next() < cutoff) it.remove();
            else break;   // ArrayDeque is ordered oldest-first.
        }
    }

    /**
     * Evict entries whose deques are empty (all stamps aged out). Runs on the
     * scheduled sweeper thread so it never blocks a request. We snapshot the
     * key set to avoid ConcurrentModificationException; missing brand-new keys
     * this pass is fine, next pass will find them.
     */
    private void evictEmpty() {
        long now = System.currentTimeMillis();
        for (String k : hits.keySet()) {
            Deque<Long> stamps = hits.get(k);
            if (stamps == null) continue;
            synchronized (stamps) {
                purgeExpired(stamps, now);
                if (stamps.isEmpty()) hits.remove(k, stamps);
            }
        }
    }

    private static String compositeEmailKey(String endpoint, String email) {
        String norm = normalise(email);
        if (norm == null) return null;
        return "e|" + endpoint + "|" + norm;
    }

    private static String compositeIpKey(String endpoint, String ip) {
        if (ip == null) return null;
        String t = ip.trim();
        if (t.isEmpty()) return null;
        return "i|" + endpoint + "|" + t;
    }

    private static String normalise(String email) {
        if (email == null) return null;
        String t = email.trim().toLowerCase(Locale.ROOT);
        return t.isEmpty() ? null : t;
    }
}
