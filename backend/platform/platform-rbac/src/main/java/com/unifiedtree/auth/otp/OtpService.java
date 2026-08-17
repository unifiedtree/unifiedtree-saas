package com.unifiedtree.auth.otp;

import com.unifiedtree.auth.entity.OtpRequest;
import com.unifiedtree.auth.repository.OtpRequestRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Service layer for OTP requests. Split out of {@code OtpController} so the
 * per-verify counter increment + revoke-and-insert live in real Spring
 * proxies (self-invoked {@code @Transactional} methods from a controller do
 * NOT fire the transaction advice, and would silently commit each write on
 * its own auto-commit connection — that is exactly how a brute-force race
 * bypasses the attempts cap).
 */
@Service
public class OtpService {

    /** BCrypt cost. Same as PasswordService. */
    private static final int BCRYPT_COST = 10;

    private static final SecureRandom RNG = new SecureRandom();

    private final OtpRequestRepository repo;

    private final int ttlMinutes;
    private final int maxAttempts;

    public OtpService(OtpRequestRepository repo,
                      @Value("${otp.ttl-minutes:10}") int ttlMinutes,
                      @Value("${otp.max-attempts:5}") int maxAttempts) {
        this.repo = repo;
        this.ttlMinutes = ttlMinutes;
        this.maxAttempts = maxAttempts;
    }

    /** In-memory carrier for the plaintext OTP handed to MSG91. */
    public record NewOtp(OtpRequest entity, String plainOtp) { }

    /**
     * Rate-limit counter for a phone in a sliding window. Kept on the service
     * so the controller does not have to know the repository query name.
     */
    @Transactional(readOnly = true)
    public long countSendsSince(String phoneLast10, OffsetDateTime since) {
        return repo.countSendsSince(phoneLast10, since);
    }

    /** Revoke every SENT row for a phone and insert a fresh SENT row. Atomic. */
    @Transactional
    public NewOtp createNewOtp(String phoneLast10, String phoneE164,
                               String purpose, String requestIp, String userAgent) {
        OffsetDateTime now = OffsetDateTime.now();
        repo.revokeActiveByPhone(phoneLast10, now);

        String plainOtp = generateOtp();
        String hash = BCrypt.hashpw(plainOtp, BCrypt.gensalt(BCRYPT_COST));

        OtpRequest row = new OtpRequest();
        row.setPhoneLast10(phoneLast10);
        row.setPhoneE164(phoneE164);
        row.setOtpHash(hash);
        row.setPurpose(purpose == null ? OtpRequest.PURPOSE_LOGIN : purpose);
        row.setProvider("msg91");
        row.setCorrelationId(UUID.randomUUID());
        row.setSentAt(now);
        row.setExpiresAt(now.plusMinutes(ttlMinutes));
        row.setStatus(OtpRequest.STATUS_SENT);
        row.setAttempts(0);
        row.setMaxAttempts(maxAttempts);
        row.setRequestIp(requestIp);
        row.setUserAgent(userAgent);

        OtpRequest saved = repo.saveAndFlush(row);
        return new NewOtp(saved, plainOtp);
    }

    /** Stamp the MSG91 request id onto an existing row (post-send). */
    @Transactional
    public void recordMsg91RequestId(UUID otpRowId, String msg91RequestId) {
        if (msg91RequestId == null || msg91RequestId.isBlank()) return;
        repo.findById(otpRowId).ifPresent(r -> {
            r.setMsg91RequestId(msg91RequestId);
            repo.save(r);
        });
    }

    /**
     * Look up a row by request id. Used by the resend cooldown check.
     */
    @Transactional(readOnly = true)
    public Optional<OtpRequest> findById(UUID requestId) {
        return repo.findById(requestId);
    }

    /**
     * Single-shot verify attempt: bumps the attempts counter FIRST, then
     * compares. Transactional so counter + status changes commit together
     * regardless of the answer.
     */
    @Transactional
    public VerifyOutcome attemptVerify(UUID requestId, String otp) {
        Optional<OtpRequest> maybe = repo.findById(requestId);
        if (maybe.isEmpty()) return VerifyOutcome.notFound();
        OtpRequest r = maybe.get();

        // Terminal states — return without touching the row.
        if (OtpRequest.STATUS_VERIFIED.equals(r.getStatus())) return VerifyOutcome.alreadyUsed();
        if (OtpRequest.STATUS_REVOKED.equals(r.getStatus()))  return VerifyOutcome.revoked();
        if (OtpRequest.STATUS_LOCKED.equals(r.getStatus()))   return VerifyOutcome.locked();
        if (OtpRequest.STATUS_EXPIRED.equals(r.getStatus()))  return VerifyOutcome.expired();

        OffsetDateTime now = OffsetDateTime.now();
        if (r.getExpiresAt() != null && r.getExpiresAt().isBefore(now)) {
            r.setStatus(OtpRequest.STATUS_EXPIRED);
            repo.save(r);
            return VerifyOutcome.expired();
        }

        int newAttempts = r.getAttempts() + 1;
        r.setAttempts(newAttempts);
        int allowed = r.getMaxAttempts() > 0 ? r.getMaxAttempts() : maxAttempts;

        boolean match = BCrypt.checkpw(otp, r.getOtpHash());
        if (match) {
            r.setStatus(OtpRequest.STATUS_VERIFIED);
            r.setVerifiedAt(now);
            repo.save(r);
            return VerifyOutcome.ok(r.getPhoneE164());
        }

        if (newAttempts >= allowed) {
            r.setStatus(OtpRequest.STATUS_LOCKED);
            r.setRevokedAt(now);
            repo.save(r);
            return VerifyOutcome.locked();
        }
        repo.save(r);
        return VerifyOutcome.wrong(allowed - newAttempts);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String generateOtp() {
        while (true) {
            int n = RNG.nextInt(1_000_000);
            String s = String.format(Locale.ROOT, "%06d", n);
            if (isTrivial(s)) continue;
            return s;
        }
    }

    private static boolean isTrivial(String otp) {
        if (otp.chars().distinct().count() == 1) return true;
        if ("123456".equals(otp) || "654321".equals(otp)) return true;
        if ("012345".equals(otp) || "543210".equals(otp)) return true;
        return false;
    }

    public record VerifyOutcome(Kind kind, int attemptsRemaining, String phoneE164) {
        public enum Kind { OK, WRONG, EXPIRED, REVOKED, ALREADY_USED, LOCKED, NOT_FOUND }

        public static VerifyOutcome ok(String phone) { return new VerifyOutcome(Kind.OK, 0, phone); }
        public static VerifyOutcome wrong(int remaining) { return new VerifyOutcome(Kind.WRONG, remaining, null); }
        public static VerifyOutcome expired() { return new VerifyOutcome(Kind.EXPIRED, 0, null); }
        public static VerifyOutcome revoked() { return new VerifyOutcome(Kind.REVOKED, 0, null); }
        public static VerifyOutcome alreadyUsed() { return new VerifyOutcome(Kind.ALREADY_USED, 0, null); }
        public static VerifyOutcome locked() { return new VerifyOutcome(Kind.LOCKED, 0, null); }
        public static VerifyOutcome notFound() { return new VerifyOutcome(Kind.NOT_FOUND, 0, null); }
    }
}
