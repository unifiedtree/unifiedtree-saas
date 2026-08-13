package com.hrms.api.auth.canonical;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory sliding-window rate limiter for {@code POST /v1/canonical-auth/login}.
 * Blocks brute-force credential-stuffing at low cost — one map, no external
 * dependency, no schema change.
 *
 * <p>Contract:
 * <ul>
 *   <li>Key is the lowercased email. IP would be preferable, but the mobile
 *       app fans out through Cloud Run behind a single egress, so keying on
 *       IP would trivially lock everyone out on the same NAT. Email is what
 *       an attacker is stuffing anyway.</li>
 *   <li>Window: 5 minutes. Threshold: 5 failed attempts. Once {@code >=} 5
 *       failures fall inside the window, {@link #check} returns a positive
 *       {@code retryAfterSeconds} value and the controller returns 429.</li>
 *   <li>Successful login clears the email's counter — the "I fat-fingered my
 *       password four times, got in on the fifth" case must never lock the
 *       user out on the next visit.</li>
 *   <li>Never grows unbounded — successful clears drop the entry, and each
 *       {@link #check} + {@link #recordFailure} call drops timestamps that
 *       fell out of the window (and drops the entry entirely if empty).</li>
 * </ul>
 *
 * <p>Deliberately in-memory: this stops the noisy 90% of scripted attacks,
 * costs nothing, and does not require Redis. It is per-instance — a login
 * flood would need to hit ~N * 5 attempts (N replicas) to cross every
 * instance's threshold, which is acceptable at our fleet size and is the
 * same tradeoff every other single-node limiter here (invitation resend,
 * password reset) already takes.
 */
@Component
public class LoginRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(LoginRateLimiter.class);

    /** Fails allowed inside {@link #WINDOW} before we start returning 429. */
    static final int MAX_FAILURES = 5;
    /** Sliding-window length. */
    static final Duration WINDOW = Duration.ofMinutes(5);

    /** Failed-attempt timestamps per lowercased email. */
    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

    /**
     * @return a {@link CheckResult} — {@link CheckResult#allowed()} is {@code true}
     *         if the caller may proceed, {@code false} with a positive
     *         {@code retryAfterSeconds} otherwise.
     */
    public CheckResult check(String email) {
        String key = normalise(email);
        if (key == null) return CheckResult.pass();

        Deque<Instant> stamps = failures.get(key);
        if (stamps == null) return CheckResult.pass();
        long retryAfter;
        synchronized (stamps) {
            purgeExpired(stamps, Instant.now());
            if (stamps.size() < MAX_FAILURES) {
                // Prune the entry entirely once it's empty so the map doesn't
                // grow forever with one-shot typos.
                if (stamps.isEmpty()) failures.remove(key, stamps);
                return CheckResult.pass();
            }
            // Retry-After ≈ time until the OLDEST timestamp falls out of the window.
            Instant oldest = stamps.peekFirst();
            Instant releaseAt = oldest.plus(WINDOW);
            retryAfter = Math.max(1, Duration.between(Instant.now(), releaseAt).getSeconds());
        }
        return CheckResult.block(retryAfter);
    }

    /** Called after a login attempt returns INVALID_CREDENTIALS. */
    public void recordFailure(String email) {
        String key = normalise(email);
        if (key == null) return;
        Instant now = Instant.now();
        Deque<Instant> stamps = failures.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (stamps) {
            purgeExpired(stamps, now);
            stamps.addLast(now);
            if (stamps.size() >= MAX_FAILURES) {
                log.warn("login rate-limit tripped for {} ({} failures in the last {} min)",
                        key, stamps.size(), WINDOW.toMinutes());
            }
        }
    }

    /**
     * Called on a successful login. Wipes the counter so the same user cannot
     * be locked out by their own prior typos.
     */
    public void recordSuccess(String email) {
        String key = normalise(email);
        if (key == null) return;
        failures.remove(key);
    }

    private static void purgeExpired(Deque<Instant> stamps, Instant now) {
        Instant cutoff = now.minus(WINDOW);
        Iterator<Instant> it = stamps.iterator();
        while (it.hasNext()) {
            if (it.next().isBefore(cutoff)) it.remove();
            else break;   // ArrayDeque is ordered by insertion (oldest first).
        }
    }

    private static String normalise(String email) {
        if (email == null) return null;
        String t = email.trim().toLowerCase(Locale.ROOT);
        return t.isEmpty() ? null : t;
    }

    /** Result of a rate-limit check. */
    public record CheckResult(boolean allowed, long retryAfterSeconds) {
        // Factory methods are named differently from the accessors to avoid
        // the record-component "allowed()" accessor being shadowed.
        public static CheckResult pass()              { return new CheckResult(true, 0); }
        public static CheckResult block(long seconds) { return new CheckResult(false, seconds); }
    }
}
