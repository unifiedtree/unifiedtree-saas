package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.settings.CelebrationSettingService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.workforce.service.MilestoneWindow;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * "Send wishes" on Celebrations (V143.84, {@code hrms.celebration_wishes}, JDBC
 * only): one colleague sends another a short message on their birthday, their
 * work anniversary, or to welcome them aboard, and the person is told in the app
 * and on their phone (CELEBRATION_WISH, {@link CelebrationWishNotifier}).
 *
 * <p>Who can send: anyone who sees the Celebrations list (signed in with an
 * employee record; the hrms module, as {@code /v1/ess} is behind it), to the
 * people that list shows them: active people of their own company, never
 * themself. When:
 * <ul>
 *   <li>a birthday or a work anniversary on the day itself (the list's rule for
 *       the day: the next occurrence, 29 February on 28 February in other years,
 *       never the joining year itself), and no birthdays in a company that hides
 *       them ({@link CelebrationSettingService});</li>
 *   <li>a welcome while the person is on Welcome aboard: joined in the last
 *       {@value CelebrationsService#JOINED_DAYS} days, up to today.</li>
 * </ul>
 * One wish per sender, per person, per occasion, per date: sending again answers
 * with the wish already sent ({@code created: false}) and tells nobody twice.
 * The message is plain text, its spaces and line breaks folded, 1 to
 * {@value #MESSAGE_MAX} characters.
 *
 * <p>While the table is missing both endpoints answer FEATURE_NOT_READY, and the
 * website and the app hide "Send wishes".
 */
@Service
public class CelebrationWishService {

    static final String TABLE = "hrms.celebration_wishes";
    public static final int MESSAGE_MAX = 280;
    /** Wishes received in the last week count on the person's own card. */
    static final int RECEIVED_DAYS = CelebrationsService.PAST_DAYS;
    /** Wishes sent reach back as far as Welcome aboard, so every button on the page knows. */
    static final int SENT_DAYS = CelebrationsService.JOINED_DAYS;
    static final int RECEIVED_LIMIT = 100;
    static final int SENT_LIMIT = 500;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** The three occasions, with the Celebrations kind each belongs to. */
    public enum Occasion {
        BIRTHDAY("BIRTHDAY", "birthday", "wished you a happy birthday"),
        ANNIVERSARY("WORK_ANNIVERSARY", "work anniversary", "wished you a happy work anniversary"),
        WELCOME("NEW_JOINER", "welcome", "welcomed you aboard");

        /** The Celebrations list's kind (BIRTHDAY, WORK_ANNIVERSARY, NEW_JOINER). */
        public final String kind;
        final String words;
        /** The notification's "{{senderName}} {{occasionText}}". */
        final String sentence;

        Occasion(String kind, String words, String sentence) {
            this.kind = kind;
            this.words = words;
            this.sentence = sentence;
        }

        /** BIRTHDAY, ANNIVERSARY or WELCOME, or the list's own kinds; null for anything else. */
        public static Occasion parse(String raw) {
            if (raw == null) return null;
            String v = raw.trim().toUpperCase(Locale.ROOT);
            for (Occasion o : values()) if (o.name().equals(v) || o.kind.equals(v)) return o;
            return null;
        }
    }

    /** POST body. {@code occasion}: BIRTHDAY, ANNIVERSARY or WELCOME (the list's kinds are accepted too). */
    public record SendRequest(UUID toEmployeeId, String occasion, String message) {}

    /** One wish. {@code fromName}: the sender's name (their employee code when they have none). */
    public record Wish(UUID id, UUID fromEmployeeId, String fromName, UUID toEmployeeId, String occasion,
                       LocalDate occasionDate, String message, Instant createdAt) {}

    /** POST answer: the wish, and whether this call sent it (false: it was sent before, nobody was told again). */
    public record SendResult(Wish wish, boolean created) {}

    /** A wish the caller sent: who to, for what, for which day. */
    public record SentRef(UUID toEmployeeId, String occasion, LocalDate occasionDate) {}

    /**
     * GET answer: the wishes the caller received in the last {@value #RECEIVED_DAYS}
     * days (newest first), how many people sent them, and the wishes they sent
     * for occasions in the last {@value #SENT_DAYS} days.
     */
    public record Mine(LocalDate today, List<Wish> received, int receivedPeople, List<SentRef> sent) {}

    /** The fields of a person the rules need. */
    record Person(UUID id, UUID companyId, String name, LocalDate dateOfBirth, LocalDate dateOfJoining, boolean active) {}

    private final JdbcTemplate jdbc;
    private final CelebrationSettingService settings;
    private final ApplicationEventPublisher events;

    public CelebrationWishService(JdbcTemplate jdbc, CelebrationSettingService settings, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.events = events;
    }

    // ── send ────────────────────────────────────────────────────────────────

    /** POST /v1/ess/celebrations/wishes. */
    @Transactional
    public SendResult send(EssCaller caller, SendRequest req) {
        if (caller.tenantId() == null || !caller.hasEmployee()) throw noEmployee();
        if (req == null || req.toEmployeeId() == null) {
            throw new HrmsException("Choose who to send wishes to.", HttpStatus.BAD_REQUEST, "CELEBRATION_WISH_PERSON_REQUIRED");
        }
        Occasion occasion = Occasion.parse(req.occasion());
        if (occasion == null) {
            throw new HrmsException("Choose a birthday, a work anniversary or a welcome.", HttpStatus.BAD_REQUEST,
                    "CELEBRATION_WISH_OCCASION_INVALID");
        }
        if (req.toEmployeeId().equals(caller.employeeId())) {
            throw new HrmsException("You can't send wishes to yourself.", HttpStatus.BAD_REQUEST, "CELEBRATION_WISH_SELF");
        }
        String message = validMessage(req.message());
        UUID tenant = caller.tenantId();
        if (!tableExists()) throw new FeatureNotReady();

        Person me = person(tenant, caller.employeeId());
        if (me == null) throw noEmployee();
        Person to = person(tenant, req.toEmployeeId());
        if (to == null || !to.active() || me.companyId() == null || !Objects.equals(to.companyId(), me.companyId())) {
            throw new BusinessRuleException("You can send wishes only to people in your company's celebrations.",
                    "CELEBRATION_WISH_PERSON_INVALID");
        }
        if (occasion == Occasion.BIRTHDAY && settings != null && !settings.showBirthdays(tenant, me.companyId())) {
            throw new BusinessRuleException("Your company doesn't show birthdays, so birthday wishes are off.",
                    "CELEBRATION_BIRTHDAYS_HIDDEN");
        }
        LocalDate on = occasionDate(occasion, to, caller.today());

        UUID id = UUID.randomUUID();
        List<Instant> inserted = FeatureNotReady.guard(() -> jdbc.query("""
                INSERT INTO hrms.celebration_wishes
                       (id, tenant_id, company_id, from_employee_id, to_employee_id, occasion, occasion_date, message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, from_employee_id, to_employee_id, occasion, occasion_date) DO NOTHING
                RETURNING created_at
                """, (rs, i) -> rs.getTimestamp("created_at").toInstant(),
                id, tenant, me.companyId(), me.id(), to.id(), occasion.name(), on, message));
        if (inserted.isEmpty()) {
            List<Wish> before = FeatureNotReady.guard(() -> jdbc.query(WISH_SELECT + """
                     WHERE w.tenant_id = ? AND w.from_employee_id = ? AND w.to_employee_id = ?
                       AND w.occasion = ? AND w.occasion_date = ?
                    """, WISH, tenant, me.id(), to.id(), occasion.name(), on));
            if (!before.isEmpty()) return new SendResult(before.get(0), false);
            throw new IllegalStateException("A wish was neither saved nor found");
        }
        events.publishEvent(new CelebrationWishSentEvent(tenant, id, to.id(), me.id(), me.name(), occasion, message));
        return new SendResult(new Wish(id, me.id(), me.name(), to.id(), occasion.name(), on, message, inserted.get(0)), true);
    }

    /**
     * The day a wish is for, or a 422 when it isn't the occasion: today for a
     * birthday or a work anniversary that falls today, the joining date for
     * someone who joined in the last {@value CelebrationsService#JOINED_DAYS} days.
     */
    static LocalDate occasionDate(Occasion occasion, Person to, LocalDate today) {
        MilestoneWindow.Range day = new MilestoneWindow.Range(today, today);
        return switch (occasion) {
            case BIRTHDAY -> {
                LocalDate on = MilestoneWindow.occurrenceIn(to.dateOfBirth(), day);
                if (on == null) throw notToday("It isn't their birthday today. You can send birthday wishes on the day.");
                yield on;
            }
            case ANNIVERSARY -> {
                LocalDate on = MilestoneWindow.occurrenceIn(to.dateOfJoining(), day);
                if (on == null) throw notToday("It isn't their work anniversary today. You can send these wishes on the day.");
                yield on;
            }
            case WELCOME -> {
                LocalDate joined = to.dateOfJoining();
                if (joined == null || joined.isAfter(today) || joined.isBefore(today.minusDays(CelebrationsService.JOINED_DAYS))) {
                    throw notToday("You can welcome people in their first " + CelebrationsService.JOINED_DAYS + " days.");
                }
                yield joined;
            }
        };
    }

    /** The trimmed message, or a 400 when it is empty or longer than {@value #MESSAGE_MAX} characters. */
    static String validMessage(String raw) {
        String m = clean(raw);
        if (m.isEmpty()) {
            throw new HrmsException("Pick a message or write your own.", HttpStatus.BAD_REQUEST, "CELEBRATION_WISH_EMPTY");
        }
        if (m.length() > MESSAGE_MAX) {
            throw new HrmsException("Keep the message to " + MESSAGE_MAX + " characters.", HttpStatus.BAD_REQUEST,
                    "CELEBRATION_WISH_TOO_LONG");
        }
        return m;
    }

    /**
     * Plain text on one line: control characters (line breaks included) become
     * spaces, invisible direction and zero-width marks go, runs of spaces fold to
     * one, and the ends are trimmed. Emoji stay.
     */
    static String clean(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[\\p{Cntrl}\\u0080-\\u009F]", " ")
                .replaceAll("[\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]", "")
                .replaceAll("\\s+", " ")
                .strip();
    }

    // ── mine ────────────────────────────────────────────────────────────────

    /** GET /v1/ess/celebrations/wishes: what the caller received and sent. */
    @Transactional(readOnly = true)
    public Mine mine(EssCaller caller) {
        LocalDate today = caller.today();
        if (!tableExists()) throw new FeatureNotReady();
        if (caller.tenantId() == null || !caller.hasEmployee()) return new Mine(today, List.of(), 0, List.of());
        UUID tenant = caller.tenantId(), me = caller.employeeId();
        Timestamp since = Timestamp.from(today.minusDays(RECEIVED_DAYS).atStartOfDay(IST).toInstant());
        List<Wish> received = FeatureNotReady.guard(() -> jdbc.query(WISH_SELECT + """
                 WHERE w.tenant_id = ? AND w.to_employee_id = ? AND w.created_at >= ?
                 ORDER BY w.created_at DESC
                 LIMIT ?
                """, WISH, tenant, me, since, RECEIVED_LIMIT));
        Integer people = FeatureNotReady.guard(() -> jdbc.queryForObject("""
                SELECT count(DISTINCT from_employee_id) FROM hrms.celebration_wishes
                 WHERE tenant_id = ? AND to_employee_id = ? AND created_at >= ?
                """, Integer.class, tenant, me, since));
        List<SentRef> sent = FeatureNotReady.guard(() -> jdbc.query("""
                SELECT to_employee_id, occasion, occasion_date FROM hrms.celebration_wishes
                 WHERE tenant_id = ? AND from_employee_id = ? AND occasion_date >= ?
                 ORDER BY occasion_date DESC, created_at DESC
                 LIMIT ?
                """, (rs, i) -> new SentRef(rs.getObject("to_employee_id", UUID.class), rs.getString("occasion"),
                rs.getObject("occasion_date", LocalDate.class)), tenant, me, today.minusDays(SENT_DAYS), SENT_LIMIT));
        return new Mine(today, received, people == null ? 0 : people, sent);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** A person of this workspace, or null. */
    Person person(UUID tenantId, UUID employeeId) {
        List<Person> rows = jdbc.query("""
                SELECT e.id, e.company_id, e.first_name, e.last_name, e.employee_code, e.date_of_birth, e.date_of_joining, e.is_active
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.id = ?
                """, (rs, i) -> new Person(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                nameOf(rs.getString("first_name"), rs.getString("last_name"), rs.getString("employee_code")),
                rs.getObject("date_of_birth", LocalDate.class), rs.getObject("date_of_joining", LocalDate.class),
                rs.getBoolean("is_active")), tenantId, employeeId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    static String nameOf(String first, String last, String code) {
        String name = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
        if (!name.isEmpty()) return name;
        return code == null || code.isBlank() ? "A colleague" : code;
    }

    /** to_regclass never fails, so this is safe inside a transaction. */
    boolean tableExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, TABLE));
    }

    private static BusinessRuleException noEmployee() {
        return new BusinessRuleException("You need an employee record to send wishes.", "NO_EMPLOYEE_RECORD");
    }

    private static BusinessRuleException notToday(String message) {
        return new BusinessRuleException(message, "CELEBRATION_WISH_NOT_THE_DAY");
    }

    private static final String WISH_SELECT = """
            SELECT w.id, w.from_employee_id, w.to_employee_id, w.occasion, w.occasion_date, w.message, w.created_at,
                   s.first_name, s.last_name, s.employee_code
              FROM hrms.celebration_wishes w
              LEFT JOIN hrms.employees s ON s.id = w.from_employee_id AND s.tenant_id = w.tenant_id
            """;

    private static final RowMapper<Wish> WISH = (rs, i) -> new Wish(
            rs.getObject("id", UUID.class), rs.getObject("from_employee_id", UUID.class),
            nameOf(rs.getString("first_name"), rs.getString("last_name"), rs.getString("employee_code")),
            rs.getObject("to_employee_id", UUID.class), rs.getString("occasion"),
            rs.getObject("occasion_date", LocalDate.class), rs.getString("message"),
            rs.getTimestamp("created_at").toInstant());
}
