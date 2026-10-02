package com.hrms.api.letters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.letters.dto.CreateDistributionRequest;
import com.hrms.letters.dto.DistributionJobDto;
import com.hrms.letters.dto.RecipientFilter;
import com.hrms.letters.repository.LetterTemplateRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * "Send on": a distribution set up now and sent on a later date (redesign BW-73).
 *
 * <ul>
 *   <li>HR picks the letter, the recipients and a date after today. The request
 *       is kept in {@code letters.distribution_schedules} (JDBC only, V143.60)
 *       and shown as "Scheduled" until it starts; Cancel deletes it.</li>
 *   <li>On the chosen date, from {@value #SEND_HOUR}:00 India time, the job
 *       ({@link DistributionScheduleJob}) starts it as an ordinary distribution,
 *       exactly as "Send now" would, in the name of the person who scheduled it.
 *       Recipients are picked then, from the filter: people who joined or left
 *       in between are counted as they are on the day.</li>
 *   <li>If it can't start (no one matches any more, the template was deleted,
 *       too many recipients), it is kept as FAILED with the reason, for HR to
 *       see and remove.</li>
 * </ul>
 * Until V143.60 is applied, scheduling answers FEATURE_NOT_READY and the list
 * answers the same (the page hides it); sending now works as before.
 */
@Service
public class DistributionScheduleService {

    private static final Logger log = LoggerFactory.getLogger(DistributionScheduleService.class);

    static final String TABLE = "letters.distribution_schedules";
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** Scheduled sends start at this hour, India time, on their date. */
    static final int SEND_HOUR = 9;
    /** How far ahead a send may be scheduled. */
    static final int MAX_DAYS_AHEAD = 366;

    public record ScheduleRequest(
            @NotNull(message = "Template ID is required") UUID templateId,
            @NotBlank(message = "Title is required") @Size(max = 200) String title,
            String customMessage,
            @Size(max = 500) String subjectOverride,
            @NotNull(message = "Recipient filter is required") RecipientFilter recipientFilter,
            @NotNull(message = "Pick the date to send on") LocalDate sendOn) {}

    /**
     * A scheduled send. {@code status}: SCHEDULED (waiting for its date),
     * STARTING (being started now) or FAILED (could not start; {@code failureReason}).
     * {@code recipientsAtSchedule}: how many people the filter matched when it was scheduled.
     */
    public record ScheduledDistribution(UUID id, UUID templateId, String templateName, String title, String customMessage,
                                        String subjectOverride, RecipientFilter recipientFilter, LocalDate sendOn,
                                        String status, String failureReason, Integer recipientsAtSchedule,
                                        Instant createdAt, UUID createdBy) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final LetterDistributionService distributions;
    private final LetterTemplateRepository templates;
    private final AuditService audit;

    public DistributionScheduleService(JdbcTemplate jdbc, ObjectMapper json, LetterDistributionService distributions,
                                       LetterTemplateRepository templates, AuditService audit) {
        this.jdbc = jdbc;
        this.json = json;
        this.distributions = distributions;
        this.templates = templates;
        this.audit = audit;
    }

    public boolean ready() {
        Boolean present = jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, TABLE);
        return Boolean.TRUE.equals(present);
    }

    /** Sends waiting for their date, and the ones that could not start, soonest first. */
    @Transactional(readOnly = true)
    public List<ScheduledDistribution> list() {
        if (!ready()) throw new FeatureNotReady();
        UUID tenant = TenantContext.requireTenantId();
        List<ScheduledDistribution> rows = FeatureNotReady.guard(() -> jdbc.query(
                SELECT + " WHERE tenant_id = ? AND status IN ('SCHEDULED', 'STARTING', 'FAILED') ORDER BY send_on, created_at",
                row(), tenant));
        Map<UUID, String> names = distributions.templateNames(rows.stream().map(ScheduledDistribution::templateId).toList());
        return rows.stream().map(r -> withName(r, names.get(r.templateId()))).toList();
    }

    /** Keep a send for {@code req.sendOn()}: a date after today (India time), at most a year ahead. */
    @Transactional
    public ScheduledDistribution schedule(ScheduleRequest req, UUID createdBy) {
        if (!ready()) throw new FeatureNotReady();
        LocalDate today = LocalDate.now(IST);
        if (!req.sendOn().isAfter(today))
            throw new HrmsException("Pick a date after today, or send it now.", HttpStatus.UNPROCESSABLE_ENTITY, "SEND_ON_NOT_FUTURE");
        if (req.sendOn().isAfter(today.plusDays(MAX_DAYS_AHEAD)))
            throw new HrmsException("Pick a date within the next year.", HttpStatus.UNPROCESSABLE_ENTITY, "SEND_ON_TOO_FAR");
        templates.findActiveById(req.templateId())
                .orElseThrow(() -> new HrmsException("Letter template not found: " + req.templateId(),
                        HttpStatus.BAD_REQUEST, "TEMPLATE_NOT_FOUND"));
        int[] counted = distributions.countRecipients(req.recipientFilter());
        LetterDistributionService.checkRecipientCount(counted[0]);
        UUID tenant = TenantContext.requireTenantId();
        UUID id = FeatureNotReady.guard(() -> jdbc.queryForObject("""
                INSERT INTO letters.distribution_schedules
                    (tenant_id, template_id, title, custom_message, subject_override, recipient_filter, send_on,
                     status, recipients_at_schedule, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'SCHEDULED', ?, ?, now())
                RETURNING id
                """, UUID.class, tenant, req.templateId(), req.title().strip(), blankToNull(req.customMessage()),
                blankToNull(req.subjectOverride()), toJson(req.recipientFilter()), req.sendOn(), counted[0], createdBy));
        record("DISTRIBUTION_SCHEDULED", id, "Scheduled '" + req.title().strip() + "' for " + req.sendOn() + ": "
                + counted[0] + " recipients today");
        return one(tenant, id);
    }

    /** Cancel a send that hasn't started (or remove one that failed to start). */
    @Transactional
    public void cancel(UUID id) {
        if (!ready()) throw new FeatureNotReady();
        UUID tenant = TenantContext.requireTenantId();
        List<String> titles = jdbc.queryForList(
                "DELETE FROM letters.distribution_schedules WHERE tenant_id = ? AND id = ? AND status IN ('SCHEDULED', 'FAILED') RETURNING title",
                String.class, tenant, id);
        if (titles.isEmpty())
            throw new HrmsException("This send has already started, or was cancelled.", HttpStatus.CONFLICT, "SCHEDULE_NOT_CANCELLABLE");
        record("DISTRIBUTION_SCHEDULE_CANCELLED", id, "Cancelled the scheduled send '" + titles.get(0) + "'");
    }

    // ── The job's side (tenant bound by the caller) ──────────────────────────

    /** The last date whose sends are due at {@code now}: today from SEND_HOUR, else yesterday. */
    static LocalDate dueThrough(ZonedDateTime now) {
        ZonedDateTime ist = now.withZoneSameInstant(IST);
        return ist.getHour() >= SEND_HOUR ? ist.toLocalDate() : ist.toLocalDate().minusDays(1);
    }

    /** Ids of this tenant's sends that are due; empty while the table is missing. */
    @Transactional(readOnly = true)
    public List<UUID> dueIds(UUID tenant, LocalDate through) {
        if (!ready()) return List.of();
        return jdbc.queryForList("SELECT id FROM letters.distribution_schedules WHERE tenant_id = ? AND status = 'SCHEDULED' "
                + "AND send_on <= ? ORDER BY send_on, created_at", UUID.class, tenant, through);
    }

    /**
     * Start one due send as a distribution, in one transaction: claim it (so two
     * servers never start it twice), create the distribution, mark it STARTED.
     * Anything that stops the distribution rolls the claim back; the job then
     * records the reason with {@link #markFailed}.
     *
     * @return the distribution's id, or null when another server took it first
     */
    @Transactional
    public UUID startOne(UUID tenant, UUID id, LocalDate through) {
        int claimed = jdbc.update("UPDATE letters.distribution_schedules SET status = 'STARTING' "
                + "WHERE tenant_id = ? AND id = ? AND status = 'SCHEDULED' AND send_on <= ?", tenant, id, through);
        if (claimed == 0) return null;
        ScheduledDistribution s = one(tenant, id);
        TenantContext.setUserId(s.createdBy());
        DistributionJobDto job = distributions.createDistribution(new CreateDistributionRequest(
                s.templateId(), s.title(), s.customMessage(), s.subjectOverride(), s.recipientFilter()), s.createdBy());
        jdbc.update("UPDATE letters.distribution_schedules SET status = 'STARTED', job_id = ?, started_at = now() "
                + "WHERE tenant_id = ? AND id = ?", job.id(), tenant, id);
        record("DISTRIBUTION_SCHEDULE_STARTED", id, "Started the scheduled send '" + s.title() + "'");
        return job.id();
    }

    /** A due send that could not start: kept as FAILED with the reason, for HR to see. */
    @Transactional
    public void markFailed(UUID tenant, UUID id, String reason) {
        jdbc.update("UPDATE letters.distribution_schedules SET status = 'FAILED', failure_reason = ? "
                + "WHERE tenant_id = ? AND id = ? AND status IN ('SCHEDULED', 'STARTING')",
                LetterSigningService.truncate(reason == null ? "It could not start." : reason, 500), tenant, id);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static final String SELECT = """
            SELECT id, template_id, title, custom_message, subject_override, recipient_filter::text AS recipient_filter,
                   send_on, status, failure_reason, recipients_at_schedule, created_at, created_by
              FROM letters.distribution_schedules""";

    private ScheduledDistribution one(UUID tenant, UUID id) {
        List<ScheduledDistribution> rows = jdbc.query(SELECT + " WHERE tenant_id = ? AND id = ?", row(), tenant, id);
        if (rows.isEmpty()) throw new HrmsException("Scheduled send not found", HttpStatus.NOT_FOUND, "SCHEDULE_NOT_FOUND");
        ScheduledDistribution r = rows.get(0);
        return withName(r, distributions.templateNames(List.of(r.templateId())).get(r.templateId()));
    }

    private RowMapper<ScheduledDistribution> row() {
        return (rs, n) -> new ScheduledDistribution(
                rs.getObject("id", UUID.class), rs.getObject("template_id", UUID.class), null,
                rs.getString("title"), rs.getString("custom_message"), rs.getString("subject_override"),
                fromJson(rs.getString("recipient_filter")), rs.getObject("send_on", LocalDate.class),
                rs.getString("status"), rs.getString("failure_reason"), (Integer) rs.getObject("recipients_at_schedule"),
                instant(rs.getTimestamp("created_at")), rs.getObject("created_by", UUID.class));
    }

    private static ScheduledDistribution withName(ScheduledDistribution r, String name) {
        return new ScheduledDistribution(r.id(), r.templateId(), name, r.title(), r.customMessage(), r.subjectOverride(),
                r.recipientFilter(), r.sendOn(), r.status(), r.failureReason(), r.recipientsAtSchedule(), r.createdAt(), r.createdBy());
    }

    String toJson(RecipientFilter f) {
        try {
            return json.writeValueAsString(f);
        } catch (JsonProcessingException e) {
            throw new HrmsException("The recipients couldn’t be saved.", HttpStatus.BAD_REQUEST, "BAD_FILTER");
        }
    }

    RecipientFilter fromJson(String raw) {
        try {
            return raw == null ? null : json.readValue(raw, RecipientFilter.class);
        } catch (JsonProcessingException e) {
            log.warn("Unreadable recipient filter on a scheduled send: {}", e.getMessage());
            return null;
        }
    }

    private void record(String action, UUID id, String summary) {
        try {
            audit.record("letters", action, "distribution_schedule", id, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for {}: {}", action, e.getMessage());
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
