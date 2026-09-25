package com.hrms.api.hiring;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.notifications.events.InterviewNotificationEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Interview scheduling and scorecards for the hiring pipeline (V143.20).
 *
 * <p>Who sees what:
 * <ul>
 *   <li>Hiring roles ({@code hrms.hiring.read}) see every interview and every scorecard.</li>
 *   <li>An assigned interviewer ({@code hrms.hiring.interview.self}) sees the interviews they are on
 *       and only their own scorecard, and submits it once the interview has started.</li>
 *   <li>Scheduling, rescheduling and cancelling need {@code hrms.hiring.interview.write}
 *       (checked by the controller).</li>
 * </ul>
 * Interviewers are notified of every change through {@link InterviewNotificationEvent}.
 */
@Service
public class InterviewService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ApplicationEventPublisher events;

    public InterviewService(JdbcTemplate jdbc, ObjectMapper mapper, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.events = events;
    }

    // ── DTOs ─────────────────────────────────────────────────────────────────

    public record Interviewer(UUID employeeId, String name, boolean submitted) {}

    public record Scorecard(UUID id, UUID interviewerId, String interviewerName, List<InterviewRules.Rating> ratings,
                            BigDecimal overallRating, String strengths, String concerns, String recommendation,
                            Instant submittedAt, Instant updatedAt) {}

    public record Interview(UUID id, UUID candidateId, String candidateName, String candidateStage,
                            UUID requisitionId, String roleTitle, String title, Instant scheduledAt,
                            LocalDateTime scheduledAtIst, int durationMinutes, String mode, String location,
                            List<String> criteria, String notes, String status, String cancelReason,
                            Instant cancelledAt, List<Interviewer> interviewers, List<Scorecard> scorecards,
                            boolean started) {}

    public record CandidateCard(UUID id, UUID requisitionId, String requisitionTitle, String fullName, String email,
                                String phone, String stage, String source, BigDecimal expectedCtc, String notes,
                                Instant createdAt, UUID convertedEmployeeId, Instant convertedAt,
                                int upcomingInterviews, Instant nextInterviewAt, InterviewRules.Summary scorecards) {}

    public record ScorecardRequest(List<InterviewRules.Rating> ratings, String strengths, String concerns, String recommendation) {}

    // ── Pipeline ─────────────────────────────────────────────────────────────

    /**
     * Candidates across the pipeline, optionally for one requisition, one stage
     * and/or one company, each with their interview and scorecard summary.
     */
    @Transactional(readOnly = true)
    public List<CandidateCard> candidates(UUID requisitionId, String stage, UUID companyId) {
        UUID tenant = TenantContext.requireTenantId();
        StringBuilder where = new StringBuilder(" WHERE c.tenant_id = ?");
        List<Object> args = new ArrayList<>(List.of(tenant));
        if (requisitionId != null) { where.append(" AND c.requisition_id = ?"); args.add(requisitionId); }
        if (stage != null && !stage.isBlank()) { where.append(" AND c.stage = ?"); args.add(stage.trim().toUpperCase(java.util.Locale.ROOT)); }
        if (companyId != null) { where.append(" AND r.company_id = ?"); args.add(companyId); }
        String from = """
                  FROM hiring_mgmt.candidates c
                  JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                """;

        Map<UUID, List<BigDecimal>> ratings = new HashMap<>();
        Map<UUID, List<String>> recs = new HashMap<>();
        jdbc.query("SELECT i.candidate_id, s.overall_rating, s.recommendation" + from
                        + " JOIN hiring_mgmt.interviews i ON i.candidate_id = c.id AND i.tenant_id = c.tenant_id"
                        + " JOIN hiring_mgmt.interview_scorecards s ON s.interview_id = i.id AND s.tenant_id = i.tenant_id"
                        + where,
                rs -> {
                    UUID cid = rs.getObject("candidate_id", UUID.class);
                    ratings.computeIfAbsent(cid, k -> new ArrayList<>()).add(rs.getBigDecimal("overall_rating"));
                    recs.computeIfAbsent(cid, k -> new ArrayList<>()).add(rs.getString("recommendation"));
                }, args.toArray());

        return jdbc.query("""
                SELECT c.id, c.requisition_id, r.title AS requisition_title, c.full_name, c.email, c.phone, c.stage,
                       c.source, c.expected_ctc, c.notes, c.created_at, c.converted_employee_id, c.converted_at,
                       (SELECT count(*) FROM hiring_mgmt.interviews i
                         WHERE i.tenant_id = c.tenant_id AND i.candidate_id = c.id AND i.status = 'SCHEDULED'
                           AND i.scheduled_at + make_interval(mins => i.duration_minutes) >= now()) AS upcoming,
                       (SELECT min(i.scheduled_at) FROM hiring_mgmt.interviews i
                         WHERE i.tenant_id = c.tenant_id AND i.candidate_id = c.id AND i.status = 'SCHEDULED'
                           AND i.scheduled_at + make_interval(mins => i.duration_minutes) >= now()) AS next_at
                """ + from + where + " ORDER BY c.created_at ASC, c.id LIMIT 1000",
                (rs, i) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    return new CandidateCard(id, rs.getObject("requisition_id", UUID.class), rs.getString("requisition_title"),
                            rs.getString("full_name"), rs.getString("email"), rs.getString("phone"), rs.getString("stage"),
                            rs.getString("source"), rs.getBigDecimal("expected_ctc"), rs.getString("notes"),
                            instant(rs, "created_at"), rs.getObject("converted_employee_id", UUID.class), instant(rs, "converted_at"),
                            rs.getInt("upcoming"), instant(rs, "next_at"),
                            InterviewRules.summarise(ratings.getOrDefault(id, List.of()), recs.getOrDefault(id, List.of())));
                }, args.toArray());
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** Every interview of one candidate (hiring roles), with all scorecards. */
    @Transactional(readOnly = true)
    public List<Interview> forCandidate(UUID candidateId) {
        UUID tenant = TenantContext.requireTenantId();
        candidateFacts(tenant, candidateId);
        return load(tenant, " AND i.candidate_id = ?", List.of(candidateId), " ORDER BY i.scheduled_at DESC", null);
    }

    /** Scheduled interviews that have not finished yet, soonest first (hiring roles). */
    @Transactional(readOnly = true)
    public List<Interview> upcoming(UUID companyId) {
        UUID tenant = TenantContext.requireTenantId();
        String clause = " AND i.status = 'SCHEDULED' AND i.scheduled_at + make_interval(mins => i.duration_minutes) >= now()";
        List<Object> args = new ArrayList<>();
        if (companyId != null) { clause += " AND r.company_id = ?"; args.add(companyId); }
        return load(tenant, clause, args, " ORDER BY i.scheduled_at ASC LIMIT 200", null);
    }

    /** The interviews the signed-in employee is on: upcoming ones and those of the last 60 days. Own scorecard only. */
    @Transactional(readOnly = true)
    public List<Interview> mine(UUID employeeId) {
        if (employeeId == null) return List.of();
        UUID tenant = TenantContext.requireTenantId();
        return load(tenant, " AND i.status = 'SCHEDULED' AND i.scheduled_at >= now() - interval '60 days'"
                        + " AND EXISTS (SELECT 1 FROM hiring_mgmt.interview_interviewers x"
                        + "             WHERE x.tenant_id = i.tenant_id AND x.interview_id = i.id AND x.employee_id = ?)",
                List.of(employeeId), " ORDER BY i.scheduled_at ASC", employeeId);
    }

    /**
     * One interview. Hiring roles see everything; anyone else must be one of
     * its interviewers and sees only their own scorecard.
     */
    @Transactional(readOnly = true)
    public Interview get(UUID interviewId, UUID viewerEmployeeId, boolean hiringRole) {
        UUID tenant = TenantContext.requireTenantId();
        if (!hiringRole) assertInterviewer(tenant, interviewId, viewerEmployeeId);
        return one(tenant, interviewId, hiringRole ? null : viewerEmployeeId);
    }

    // ── Scheduling ───────────────────────────────────────────────────────────

    @Transactional
    public Interview schedule(UUID candidateId, InterviewRules.Schedule request, UUID actorUserId) {
        UUID tenant = TenantContext.requireTenantId();
        CandidateFacts candidate = candidateFacts(tenant, candidateId);
        InterviewRules.assertStageAllowsScheduling(candidate.stage());
        InterviewRules.CleanSchedule s = InterviewRules.clean(request, Instant.now());
        assertActiveEmployees(tenant, s.interviewerIds());
        UUID id = jdbc.queryForObject("""
                INSERT INTO hiring_mgmt.interviews
                    (tenant_id, candidate_id, title, scheduled_at, duration_minutes, mode, location, criteria, notes,
                     status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'SCHEDULED', ?, ?)
                RETURNING id
                """, UUID.class, tenant, candidateId, s.title(), utc(s.scheduledAt()), s.durationMinutes(),
                s.mode(), s.location(), json(s.criteria()), s.notes(), actorUserId, actorUserId);
        for (UUID employee : s.interviewerIds()) addInterviewer(tenant, id, employee);
        notify(tenant, id, "SCHEDULED", s.interviewerIds(), candidate, s.title(), s.scheduledAt(), s.durationMinutes(), s.mode(), s.location());
        return one(tenant, id, null);
    }

    @Transactional
    public Interview reschedule(UUID interviewId, InterviewRules.Schedule request, UUID actorUserId) {
        UUID tenant = TenantContext.requireTenantId();
        Row current = lockRow(tenant, interviewId);
        if (!"SCHEDULED".equals(current.status())) throw new BusinessRuleException("A cancelled interview can't be changed. Schedule a new one.", "INTERVIEW_CANCELLED");
        if (scorecardCount(tenant, interviewId) > 0) throw new BusinessRuleException("This interview already has feedback, so it can't be moved. Schedule a new round instead.", "INTERVIEW_HAS_FEEDBACK");
        CandidateFacts candidate = candidateFacts(tenant, current.candidateId());
        InterviewRules.assertStageAllowsScheduling(candidate.stage());
        InterviewRules.CleanSchedule s = InterviewRules.clean(request, Instant.now(), current.scheduledAt());
        assertActiveEmployees(tenant, s.interviewerIds());

        List<UUID> before = interviewerIds(tenant, interviewId);
        boolean changed = !current.scheduledAt().equals(s.scheduledAt()) || current.durationMinutes() != s.durationMinutes()
                || !current.mode().equals(s.mode()) || !Objects.equals(current.location(), s.location());
        InterviewRules.Diff diff = InterviewRules.diff(before, s.interviewerIds(), changed);

        jdbc.update("""
                UPDATE hiring_mgmt.interviews
                   SET title = ?, scheduled_at = ?, duration_minutes = ?, mode = ?, location = ?, criteria = ?::jsonb,
                       notes = ?, updated_at = now(), updated_by = ?
                 WHERE tenant_id = ? AND id = ?
                """, s.title(), utc(s.scheduledAt()), s.durationMinutes(), s.mode(), s.location(),
                json(s.criteria()), s.notes(), actorUserId, tenant, interviewId);
        for (UUID removed : diff.removed())
            jdbc.update("DELETE FROM hiring_mgmt.interview_interviewers WHERE tenant_id = ? AND interview_id = ? AND employee_id = ?", tenant, interviewId, removed);
        for (UUID added : diff.added()) addInterviewer(tenant, interviewId, added);

        notify(tenant, interviewId, "SCHEDULED", diff.added(), candidate, s.title(), s.scheduledAt(), s.durationMinutes(), s.mode(), s.location());
        notify(tenant, interviewId, "REMOVED", diff.removed(), candidate, s.title(), s.scheduledAt(), s.durationMinutes(), s.mode(), s.location());
        if (diff.detailsChanged())
            notify(tenant, interviewId, "RESCHEDULED", diff.kept(), candidate, s.title(), s.scheduledAt(), s.durationMinutes(), s.mode(), s.location());
        return one(tenant, interviewId, null);
    }

    @Transactional
    public Interview cancel(UUID interviewId, String reason, UUID actorUserId) {
        UUID tenant = TenantContext.requireTenantId();
        Row current = lockRow(tenant, interviewId);
        if (!"SCHEDULED".equals(current.status())) throw new BusinessRuleException("This interview is already cancelled", "INTERVIEW_CANCELLED");
        if (scorecardCount(tenant, interviewId) > 0) throw new BusinessRuleException("This interview already has feedback, so it can't be cancelled", "INTERVIEW_HAS_FEEDBACK");
        String why = InterviewRules.trimToNull(reason);
        if (why != null && why.length() > 500) throw new BusinessRuleException("Keep the reason under 500 characters", "INTERVIEW_REASON_TOO_LONG");
        jdbc.update("""
                UPDATE hiring_mgmt.interviews
                   SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = now(), updated_at = now(), updated_by = ?
                 WHERE tenant_id = ? AND id = ?
                """, why, actorUserId, tenant, interviewId);
        CandidateFacts candidate = candidateFacts(tenant, current.candidateId());
        notify(tenant, interviewId, "CANCELLED", interviewerIds(tenant, interviewId), candidate, current.title(),
                current.scheduledAt(), current.durationMinutes(), current.mode(), current.location());
        return one(tenant, interviewId, null);
    }

    // ── Scorecards ───────────────────────────────────────────────────────────

    /** An assigned interviewer submits (or corrects) their own scorecard once the interview has started. */
    @Transactional
    public Interview submitScorecard(UUID interviewId, UUID interviewerEmployeeId, ScorecardRequest request, boolean hiringRole) {
        UUID tenant = TenantContext.requireTenantId();
        assertInterviewer(tenant, interviewId, interviewerEmployeeId);
        Row current = lockRow(tenant, interviewId);
        if (!"SCHEDULED".equals(current.status())) throw new BusinessRuleException("This interview was cancelled", "INTERVIEW_CANCELLED");
        if (current.scheduledAt().isAfter(Instant.now())) throw new BusinessRuleException("You can submit your scorecard once the interview has started", "SCORECARD_TOO_EARLY");
        if (request == null) throw new BusinessRuleException("Rate every criterion from 1 to 5", "SCORECARD_RATINGS_REQUIRED");
        BigDecimal overall = InterviewRules.overall(current.criteria(), request.ratings());
        String recommendation = InterviewRules.recommendation(request.recommendation());
        String strengths = InterviewRules.trimToNull(request.strengths());
        String concerns = InterviewRules.trimToNull(request.concerns());
        if ((strengths != null && strengths.length() > 4000) || (concerns != null && concerns.length() > 4000))
            throw new BusinessRuleException("Keep strengths and concerns under 4000 characters each", "SCORECARD_TEXT_TOO_LONG");
        List<InterviewRules.Rating> ratings = current.criteria().stream().map(c -> new InterviewRules.Rating(c,
                request.ratings().stream().filter(r -> c.equalsIgnoreCase(r.criterion().trim())).findFirst().orElseThrow().rating())).toList();
        jdbc.update("""
                INSERT INTO hiring_mgmt.interview_scorecards
                    (tenant_id, interview_id, interviewer_id, ratings, overall_rating, strengths, concerns, recommendation)
                VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?)
                ON CONFLICT (interview_id, interviewer_id) DO UPDATE
                   SET ratings = excluded.ratings, overall_rating = excluded.overall_rating, strengths = excluded.strengths,
                       concerns = excluded.concerns, recommendation = excluded.recommendation, updated_at = now()
                """, tenant, interviewId, interviewerEmployeeId, json(ratings), overall, strengths, concerns, recommendation);
        return one(tenant, interviewId, hiringRole ? null : interviewerEmployeeId);
    }

    // ── internals ────────────────────────────────────────────────────────────

    record CandidateFacts(UUID id, String fullName, String stage, String roleTitle) {}

    private record Row(UUID id, UUID candidateId, String title, Instant scheduledAt, int durationMinutes, String mode,
                       String location, List<String> criteria, String status) {}

    private CandidateFacts candidateFacts(UUID tenant, UUID candidateId) {
        List<CandidateFacts> rows = jdbc.query("""
                SELECT c.id, c.full_name, c.stage, r.title
                  FROM hiring_mgmt.candidates c
                  JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ? AND c.id = ?
                """, (rs, i) -> new CandidateFacts(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4)),
                tenant, candidateId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Candidate", candidateId);
        return rows.getFirst();
    }

    private Row lockRow(UUID tenant, UUID interviewId) {
        List<Row> rows = jdbc.query("""
                SELECT id, candidate_id, title, scheduled_at, duration_minutes, mode, location, criteria::text AS criteria, status
                  FROM hiring_mgmt.interviews WHERE tenant_id = ? AND id = ? FOR UPDATE
                """, (rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getObject("candidate_id", UUID.class),
                        rs.getString("title"), instant(rs, "scheduled_at"), rs.getInt("duration_minutes"), rs.getString("mode"),
                        rs.getString("location"), criteria(rs.getString("criteria")), rs.getString("status")),
                tenant, interviewId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Interview", interviewId);
        return rows.getFirst();
    }

    private void assertInterviewer(UUID tenant, UUID interviewId, UUID employeeId) {
        Integer exists = jdbc.queryForObject("SELECT count(*) FROM hiring_mgmt.interviews WHERE tenant_id = ? AND id = ?",
                Integer.class, tenant, interviewId);
        if (exists == null || exists == 0) throw new ResourceNotFoundException("Interview", interviewId);
        Integer on = employeeId == null ? 0 : jdbc.queryForObject(
                "SELECT count(*) FROM hiring_mgmt.interview_interviewers WHERE tenant_id = ? AND interview_id = ? AND employee_id = ?",
                Integer.class, tenant, interviewId, employeeId);
        if (on == null || on == 0) throw new AccessDeniedException("Only the interviewers of this interview can see it or submit a scorecard for it.");
    }

    private void assertActiveEmployees(UUID tenant, List<UUID> ids) {
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(ids);
        List<UUID> found = jdbc.queryForList("""
                SELECT id FROM hrms.employees
                 WHERE tenant_id = ? AND is_active
                   AND COALESCE(employment_status, 'ACTIVE') NOT IN ('EXITED', 'TERMINATED', 'SUSPENDED')
                   AND id IN (""" + in + ")", UUID.class, args.toArray());
        if (found.size() != ids.size())
            throw new BusinessRuleException("Every interviewer must be a current employee of this workspace", "INTERVIEW_INTERVIEWER_INVALID");
    }

    private void addInterviewer(UUID tenant, UUID interviewId, UUID employeeId) {
        jdbc.update("INSERT INTO hiring_mgmt.interview_interviewers (tenant_id, interview_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                tenant, interviewId, employeeId);
    }

    private List<UUID> interviewerIds(UUID tenant, UUID interviewId) {
        return jdbc.queryForList("SELECT employee_id FROM hiring_mgmt.interview_interviewers WHERE tenant_id = ? AND interview_id = ? ORDER BY added_at, employee_id",
                UUID.class, tenant, interviewId);
    }

    private int scorecardCount(UUID tenant, UUID interviewId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM hiring_mgmt.interview_scorecards WHERE tenant_id = ? AND interview_id = ?",
                Integer.class, tenant, interviewId);
        return n == null ? 0 : n;
    }

    private void notify(UUID tenant, UUID interviewId, String kind, List<UUID> recipients, CandidateFacts candidate, String title,
                        Instant at, int duration, String mode, String location) {
        if (recipients == null || recipients.isEmpty()) return;
        events.publishEvent(new InterviewNotificationEvent(tenant, interviewId, kind, List.copyOf(recipients),
                candidate.fullName(), candidate.roleTitle(), title, at, duration, mode, location));
    }

    private Interview one(UUID tenant, UUID interviewId, UUID onlyScorecardOf) {
        List<Interview> rows = load(tenant, " AND i.id = ?", List.of(interviewId), "", onlyScorecardOf);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Interview", interviewId);
        return rows.getFirst();
    }

    /**
     * Loads interviews with their interviewers and scorecards. When
     * {@code onlyScorecardOf} is set, only that employee's scorecard is returned
     * (an interviewer does not see the others' feedback).
     */
    private List<Interview> load(UUID tenant, String clause, List<Object> clauseArgs, String order, UUID onlyScorecardOf) {
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(clauseArgs);
        Instant now = Instant.now();
        record Base(UUID id, UUID candidateId, String candidateName, String candidateStage, UUID requisitionId, String roleTitle,
                    String title, Instant at, int duration, String mode, String location, List<String> criteria, String notes,
                    String status, String cancelReason, Instant cancelledAt) {}
        List<Base> base = jdbc.query("""
                SELECT i.id, i.candidate_id, c.full_name, c.stage, c.requisition_id, r.title AS role_title, i.title,
                       i.scheduled_at, i.duration_minutes, i.mode, i.location, i.criteria::text AS criteria, i.notes,
                       i.status, i.cancel_reason, i.cancelled_at
                  FROM hiring_mgmt.interviews i
                  JOIN hiring_mgmt.candidates c ON c.id = i.candidate_id AND c.tenant_id = i.tenant_id
                  JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                 WHERE i.tenant_id = ?""" + clause + order,
                (rs, n) -> new Base(rs.getObject("id", UUID.class), rs.getObject("candidate_id", UUID.class), rs.getString("full_name"),
                        rs.getString("stage"), rs.getObject("requisition_id", UUID.class), rs.getString("role_title"), rs.getString("title"),
                        instant(rs, "scheduled_at"), rs.getInt("duration_minutes"), rs.getString("mode"), rs.getString("location"),
                        criteria(rs.getString("criteria")), rs.getString("notes"), rs.getString("status"), rs.getString("cancel_reason"),
                        instant(rs, "cancelled_at")),
                args.toArray());
        if (base.isEmpty()) return List.of();

        List<UUID> ids = base.stream().map(Base::id).toList();
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> idArgs = new ArrayList<>();
        idArgs.add(tenant);
        idArgs.addAll(ids);

        Map<UUID, List<Scorecard>> cards = new LinkedHashMap<>();
        jdbc.query("""
                SELECT s.id, s.interview_id, s.interviewer_id, concat_ws(' ', e.first_name, e.last_name) AS name,
                       s.ratings::text AS ratings, s.overall_rating, s.strengths, s.concerns, s.recommendation,
                       s.submitted_at, s.updated_at
                  FROM hiring_mgmt.interview_scorecards s
                  LEFT JOIN hrms.employees e ON e.id = s.interviewer_id AND e.tenant_id = s.tenant_id
                 WHERE s.tenant_id = ? AND s.interview_id IN (""" + in + ") ORDER BY s.submitted_at",
                rs -> {
                    cards.computeIfAbsent(rs.getObject("interview_id", UUID.class), k -> new ArrayList<>()).add(new Scorecard(
                            rs.getObject("id", UUID.class), rs.getObject("interviewer_id", UUID.class), rs.getString("name"),
                            ratings(rs.getString("ratings")), rs.getBigDecimal("overall_rating"), rs.getString("strengths"),
                            rs.getString("concerns"), rs.getString("recommendation"), instant(rs, "submitted_at"), instant(rs, "updated_at")));
                }, idArgs.toArray());

        Map<UUID, List<Interviewer>> people = new LinkedHashMap<>();
        jdbc.query("""
                SELECT x.interview_id, x.employee_id, concat_ws(' ', e.first_name, e.last_name) AS name
                  FROM hiring_mgmt.interview_interviewers x
                  LEFT JOIN hrms.employees e ON e.id = x.employee_id AND e.tenant_id = x.tenant_id
                 WHERE x.tenant_id = ? AND x.interview_id IN (""" + in + ") ORDER BY x.added_at, e.first_name",
                rs -> {
                    UUID iid = rs.getObject("interview_id", UUID.class);
                    UUID emp = rs.getObject("employee_id", UUID.class);
                    boolean submitted = cards.getOrDefault(iid, List.of()).stream().anyMatch(s -> emp.equals(s.interviewerId()));
                    people.computeIfAbsent(iid, k -> new ArrayList<>()).add(new Interviewer(emp, rs.getString("name"), submitted));
                }, idArgs.toArray());

        return base.stream().map(b -> {
            List<Scorecard> visible = cards.getOrDefault(b.id(), List.of());
            if (onlyScorecardOf != null) visible = visible.stream().filter(s -> onlyScorecardOf.equals(s.interviewerId())).toList();
            return new Interview(b.id(), b.candidateId(), b.candidateName(), b.candidateStage(), b.requisitionId(), b.roleTitle(),
                    b.title(), b.at(), InterviewRules.instantToIst(b.at()), b.duration(), b.mode(), b.location(), b.criteria(),
                    b.notes(), b.status(), b.cancelReason(), b.cancelledAt(), people.getOrDefault(b.id(), List.of()), visible,
                    !b.at().isAfter(now));
        }).toList();
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialise interview data", e);
        }
    }

    private List<String> criteria(String raw) {
        if (raw == null || raw.isBlank()) return InterviewRules.DEFAULT_CRITERIA;
        try {
            List<String> list = mapper.readValue(raw, new TypeReference<List<String>>() {});
            return list.isEmpty() ? InterviewRules.DEFAULT_CRITERIA : list;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored interview criteria are not valid JSON", e);
        }
    }

    private List<InterviewRules.Rating> ratings(String raw) {
        try {
            return raw == null ? List.of() : mapper.readValue(raw, new TypeReference<List<InterviewRules.Rating>>() {});
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored scorecard ratings are not valid JSON", e);
        }
    }

    private static java.time.OffsetDateTime utc(Instant at) {
        return at.atOffset(java.time.ZoneOffset.UTC);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
