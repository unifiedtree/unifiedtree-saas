package com.hrms.api.letters;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.service.LetterGenerationService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Letter e-signature, click to accept (redesign BW-76).
 *
 * <ul>
 *   <li>HR asks for a signature when generating or sending a letter. The request
 *       is one row in {@code letters.letter_signatures} per letter.</li>
 *   <li>Once the letter has been sent, the employee is told
 *       ({@code letters.signature_requested}), once per letter.</li>
 *   <li>The employee signs their own letter, while it is SENT or VIEWED and a
 *       signature was asked, by typing their name. The time, the typed name, the
 *       IP address and the browser are kept; the letter becomes SIGNED with its
 *       signing time (columns the letter entity already maps). Nothing is stamped
 *       on the PDF.</li>
 * </ul>
 * The table is JDBC-only (V143.60). Until it exists, reads leave the fields
 * empty and asking or signing answers FEATURE_NOT_READY. The table is looked up
 * first, so the caller's transaction is never aborted by a missing table.
 */
@Service
public class LetterSigningService {

    private static final Logger log = LoggerFactory.getLogger(LetterSigningService.class);

    static final String TABLE = "letters.letter_signatures";
    static final int NAME_MAX = 200;

    /** One letter's signature request. */
    public record Signature(UUID letterId, Instant requestedAt, String requestedByName, Instant signedAt, String signedName) {
        public boolean signed() { return signedAt != null; }
    }

    private final JdbcTemplate jdbc;
    private final LetterGenerationService letters;
    private final ApplicationEventPublisher events;
    private final AuditService audit;

    public LetterSigningService(JdbcTemplate jdbc, LetterGenerationService letters, ApplicationEventPublisher events,
                                AuditService audit) {
        this.jdbc = jdbc;
        this.letters = letters;
        this.events = events;
        this.audit = audit;
    }

    /** True when V143.60's signature table exists. */
    public boolean ready() {
        Boolean present = jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, TABLE);
        return Boolean.TRUE.equals(present);
    }

    /** Refuse up front, before anything is generated or sent, when signatures aren't switched on. */
    public void requireReady() {
        if (!ready()) throw new FeatureNotReady();
    }

    /** The signature requests of these letters, by letter id; empty while the table is missing. */
    @Transactional(readOnly = true)
    public Map<UUID, Signature> of(Collection<UUID> letterIds) {
        Map<UUID, Signature> out = new HashMap<>();
        if (letterIds == null || letterIds.isEmpty() || !ready()) return out;
        List<Object> args = new ArrayList<>();
        args.add(TenantContext.requireTenantId());
        args.addAll(letterIds);
        jdbc.query("SELECT letter_id, requested_at, requested_by_name, signed_at, signed_name FROM letters.letter_signatures "
                        + "WHERE tenant_id = ? AND letter_id IN (" + String.join(",", Collections.nCopies(letterIds.size(), "?")) + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("letter_id", UUID.class), new Signature(
                        rs.getObject("letter_id", UUID.class), instant(rs.getTimestamp("requested_at")),
                        rs.getString("requested_by_name"), instant(rs.getTimestamp("signed_at")), rs.getString("signed_name"))),
                args.toArray());
        return out;
    }

    /**
     * HR asks the employee to sign {@code letter}. Asking again changes nothing.
     * A voided or already signed letter can't be asked.
     */
    @Transactional
    public void request(GeneratedLetterDto letter, UUID requestedByUserId) {
        requireReady();
        if ("VOID".equals(letter.status()))
            throw new HrmsException("This letter is void, so it can’t be signed.", HttpStatus.CONFLICT, "LETTER_VOIDED");
        if ("SIGNED".equals(letter.status()))
            throw new HrmsException("This letter is already signed.", HttpStatus.CONFLICT, "LETTER_ALREADY_SIGNED");
        UUID tenant = TenantContext.requireTenantId();
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO letters.letter_signatures (tenant_id, letter_id, employee_id, requested_at, requested_by, requested_by_name)
                VALUES (?, ?, ?, now(), ?, ?)
                ON CONFLICT (tenant_id, letter_id) DO NOTHING
                """, tenant, letter.id(), letter.employeeId(), requestedByUserId, userName(tenant, requestedByUserId)));
        record("LETTER_SIGNATURE_REQUESTED", letter.id(), "Asked for a signature on '" + letter.subject() + "'");
    }

    /**
     * After a letter is sent: tell the employee about a signature that is asked
     * and not yet told (once per letter, after the send commits).
     */
    @Transactional
    public void notifyIfAsked(GeneratedLetterDto letter) {
        if (letter.sentAt() == null || !ready()) return;
        UUID tenant = TenantContext.requireTenantId();
        List<String> asked = jdbc.queryForList("""
                UPDATE letters.letter_signatures SET notified_at = now()
                 WHERE tenant_id = ? AND letter_id = ? AND notified_at IS NULL AND signed_at IS NULL
                RETURNING coalesce(requested_by_name, '')
                """, String.class, tenant, letter.id());
        if (asked.isEmpty()) return;
        events.publishEvent(new LetterSignatureRequestedEvent(tenant, letter.id(), letter.employeeId(), letter.subject(),
                asked.get(0).isBlank() ? null : asked.get(0)));
    }

    /**
     * The employee signs their letter. Only the letter's own employee, only a
     * letter that was sent to them and is SENT or VIEWED, and only when a
     * signature was asked and not given yet.
     */
    @Transactional
    public GeneratedLetterDto sign(UUID letterId, UUID callerEmployeeId, String typedName, String ip, String userAgent) {
        String name = typedName == null ? "" : typedName.strip().replaceAll("\\s+", " ");
        if (name.length() < 2)
            throw new HrmsException("Type your full name to sign.", HttpStatus.UNPROCESSABLE_ENTITY, "SIGNATURE_NAME_REQUIRED");
        if (name.length() > NAME_MAX)
            throw new HrmsException("Keep the name to " + NAME_MAX + " characters.", HttpStatus.UNPROCESSABLE_ENTITY, "SIGNATURE_NAME_TOO_LONG");
        requireReady();
        UUID tenant = TenantContext.requireTenantId();
        GeneratedLetterDto letter = letters.getGenerated(letterId);
        if (callerEmployeeId == null || !callerEmployeeId.equals(letter.employeeId()) || !letters.isSentToEmployee(letterId))
            throw new HrmsException("Letter not found", HttpStatus.NOT_FOUND, "LETTER_NOT_FOUND");
        List<Object[]> rows = FeatureNotReady.guard(() -> jdbc.query(
                "SELECT signed_at FROM letters.letter_signatures WHERE tenant_id = ? AND letter_id = ? FOR UPDATE",
                (rs, n) -> new Object[]{rs.getTimestamp("signed_at")}, tenant, letterId));
        if (rows.isEmpty())
            throw new HrmsException("HR hasn’t asked you to sign this letter.", HttpStatus.CONFLICT, "SIGNATURE_NOT_REQUESTED");
        if (rows.get(0)[0] != null || "SIGNED".equals(letter.status()))
            throw new HrmsException("You’ve already signed this letter.", HttpStatus.CONFLICT, "LETTER_ALREADY_SIGNED");
        if (!"SENT".equals(letter.status()) && !"VIEWED".equals(letter.status()))
            throw new HrmsException("This letter can’t be signed any more.", HttpStatus.CONFLICT, "LETTER_NOT_SIGNABLE");
        Instant now = Instant.now();
        jdbc.update("""
                UPDATE letters.letter_signatures
                   SET signed_at = ?, signed_name = ?, signed_ip = ?, signed_user_agent = ?
                 WHERE tenant_id = ? AND letter_id = ?
                """, Timestamp.from(now), name, truncate(ip, 64), truncate(userAgent, 500), tenant, letterId);
        GeneratedLetterDto signed = letters.markSigned(letterId, now);
        record("LETTER_SIGNED", letterId, "Signed '" + letter.subject() + "' as " + name);
        return signed;
    }

    /** The person's name for "Sent by": their employee name, else their sign-in name or email. */
    String userName(UUID tenant, UUID userId) {
        if (userId == null) return null;
        try {
            List<String> names = jdbc.queryForList("""
                    SELECT coalesce(nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''), nullif(trim(uc.display_name), ''), uc.email)
                      FROM auth.user_credentials uc
                      LEFT JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = uc.tenant_id
                     WHERE uc.tenant_id = ? AND uc.id = ?
                    """, String.class, tenant, userId);
            return names.isEmpty() ? null : truncate(names.get(0), 200);
        } catch (RuntimeException e) {
            log.warn("Could not read the name of user {}: {}", userId, e.getMessage());
            return null;
        }
    }

    private void record(String action, UUID letterId, String summary) {
        try {
            audit.record("letters", action, "generated_letter", letterId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for {}: {}", action, e.getMessage());
        }
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
