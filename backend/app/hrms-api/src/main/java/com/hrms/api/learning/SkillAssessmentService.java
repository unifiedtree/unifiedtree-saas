package com.hrms.api.learning;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.notifications.events.SkillAssessmentDecidedEvent;
import com.unifiedtree.notifications.events.SkillAssessmentSubmittedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Skill self-assessment (V143.21): an employee proposes a proficiency level
 * (1 to 5) for one of their skills, or a new skill, with a note. Nothing changes
 * on their record until someone approves it:
 * <ul>
 *   <li>their manager, for people in the manager's team (the same team as the
 *       My team page: the departments they head, else their direct reports), or</li>
 *   <li>HR: anyone holding {@code hrms.learning.write} decides for everyone.</li>
 * </ul>
 * Approving writes the level to {@code learning_mgmt.employee_skills} (the skill
 * matrix). Nobody decides their own proposal. Both sides are notified.
 */
@Service
public class SkillAssessmentService {

    private static final Logger log = LoggerFactory.getLogger(SkillAssessmentService.class);
    static final int MAX_NOTE = 1000;
    static final int MAX_SKILL = 120;
    static final Set<String> DECISIONS = Set.of("APPROVED", "REJECTED");

    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope teamScope;
    private final ApplicationEventPublisher events;

    public SkillAssessmentService(JdbcTemplate jdbc, TeamEmployeeScope teamScope, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.teamScope = teamScope;
        this.events = events;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record AssessmentDto(
            UUID id, UUID employeeId, String employeeName, String employeeCode, String department,
            UUID skillId, String skillName, Integer currentProficiency, int proposedProficiency,
            String employeeNote, String status, String decidedByName, String decidedAt,
            String decisionNote, String createdAt) {}

    public record ProposeRequest(
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = MAX_SKILL) String skillName,
            @jakarta.validation.constraints.NotNull
            @jakarta.validation.constraints.Min(1)
            @jakarta.validation.constraints.Max(5) Integer proposedProficiency,
            @jakarta.validation.constraints.Size(max = MAX_NOTE) String note) {}

    public record DecideRequest(
            @jakarta.validation.constraints.NotBlank String decision,
            @jakarta.validation.constraints.Size(max = MAX_NOTE) String note) {}

    // ── Employee side ─────────────────────────────────────────────────────────

    /** The caller's own proposals, newest first (every status). */
    @Transactional
    public List<AssessmentDto> mine(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        if (employeeId == null) return List.of();
        return jdbc.query(SELECT + " WHERE a.tenant_id = ? AND a.employee_id = ? ORDER BY a.created_at DESC LIMIT 100",
                (rs, i) -> toDto(rs), tenantId, employeeId);
    }

    /** Propose a level for one of your skills (or a new skill). */
    @Transactional
    public AssessmentDto propose(UUID tenantId, UUID employeeId, ProposeRequest req, UUID actorUserId) {
        bindTenant(tenantId);
        if (employeeId == null) {
            throw new BusinessRuleException("Your login isn't linked to an employee record, so there are no skills to assess.",
                    "NO_EMPLOYEE_RECORD");
        }
        String skill = validateSkillName(req.skillName());
        int level = validateLevel(req.proposedProficiency());
        String note = cleanNote(req.note());

        Integer activeEmployee = jdbc.queryForObject(
                "SELECT count(*) FROM hrms.employees WHERE tenant_id = ? AND id = ? AND is_active",
                Integer.class, tenantId, employeeId);
        if (activeEmployee == null || activeEmployee == 0) {
            throw new BusinessRuleException("Only active employees can propose skill levels", "EMPLOYEE_INACTIVE");
        }

        Object[] current = jdbc.query("""
                SELECT id, proficiency FROM learning_mgmt.employee_skills
                 WHERE tenant_id = ? AND employee_id = ? AND lower(skill_name) = lower(?)
                 ORDER BY updated_at DESC LIMIT 1
                """, rs -> rs.next() ? new Object[] { rs.getObject(1, UUID.class), rs.getInt(2) } : null,
                tenantId, employeeId, skill);
        UUID skillId = current == null ? null : (UUID) current[0];
        Integer currentLevel = current == null ? null : (Integer) current[1];
        if (currentLevel != null && currentLevel == level) {
            throw new BusinessRuleException("Your recorded level for " + skill + " is already " + level
                    + " of 5. Pick a different level.", "SKILL_LEVEL_UNCHANGED");
        }
        Integer pending = jdbc.queryForObject("""
                SELECT count(*) FROM learning_mgmt.skill_assessments
                 WHERE tenant_id = ? AND employee_id = ? AND lower(skill_name) = lower(?) AND status = 'PENDING'
                """, Integer.class, tenantId, employeeId, skill);
        if (pending != null && pending > 0) {
            throw new BusinessRuleException("You already have a proposal for " + skill
                    + " waiting for approval. Withdraw it first if you want to change it.", "SKILL_ASSESSMENT_PENDING");
        }

        UUID id;
        try {
            id = jdbc.queryForObject("""
                    INSERT INTO learning_mgmt.skill_assessments
                        (tenant_id, employee_id, skill_id, skill_name, current_proficiency,
                         proposed_proficiency, employee_note, status, created_by, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                    RETURNING id
                    """, UUID.class, tenantId, employeeId, skillId, skill, currentLevel, level, note,
                    tag(actorUserId), tag(actorUserId));
        } catch (DuplicateKeyException race) {
            throw new BusinessRuleException("You already have a proposal for " + skill
                    + " waiting for approval.", "SKILL_ASSESSMENT_PENDING");
        }
        UUID approver = resolveApprover(tenantId, employeeId);
        events.publishEvent(new SkillAssessmentSubmittedEvent(id, employeeId, tenantId, approver, skill, level, currentLevel));
        log.info("Skill assessment {} proposed employee={} skill={} level={}", id, employeeId, skill, level);
        return get(tenantId, id);
    }

    /** Withdraw one of your own proposals while it's still waiting. */
    @Transactional
    public AssessmentDto withdraw(UUID tenantId, UUID id, UUID employeeId, UUID actorUserId) {
        bindTenant(tenantId);
        Row row = load(tenantId, id);
        if (employeeId == null || !employeeId.equals(row.employeeId())) {
            throw new AccessDeniedException("You can only withdraw your own proposals");
        }
        int n = jdbc.update("""
                UPDATE learning_mgmt.skill_assessments
                   SET status = 'WITHDRAWN', updated_at = now(), updated_by = ?, version = version + 1
                 WHERE tenant_id = ? AND id = ? AND status = 'PENDING'
                """, tag(actorUserId), tenantId, id);
        if (n == 0) throw new BusinessRuleException("This proposal has already been " + words(row.status()), "SKILL_ASSESSMENT_CLOSED");
        return get(tenantId, id);
    }

    // ── Approver side ─────────────────────────────────────────────────────────

    /**
     * Proposals the caller may decide: {@code PENDING} (oldest first) or
     * {@code DECIDED} (the 50 most recent approvals and rejections). HR
     * ({@code hrms.learning.write}) sees everyone; a manager sees their team.
     * The caller's own proposals are never listed here.
     */
    @Transactional
    public List<AssessmentDto> queue(UUID tenantId, String view, Authentication auth) {
        bindTenant(tenantId);
        Set<UUID> scope = approverScope(auth);
        UUID self = callerEmployeeId(auth);
        StringBuilder sql = new StringBuilder(SELECT).append(" WHERE a.tenant_id = ?");
        List<Object> args = new ArrayList<>(List.of(tenantId));
        boolean decided = "DECIDED".equalsIgnoreCase(view);
        sql.append(decided ? " AND a.status IN ('APPROVED','REJECTED')" : " AND a.status = 'PENDING'");
        if (self != null) { sql.append(" AND a.employee_id <> ?"); args.add(self); }
        if (scope != null) {
            if (scope.isEmpty()) return List.of();
            sql.append(" AND a.employee_id IN (")
               .append(scope.stream().map(x -> "?").collect(Collectors.joining(","))).append(')');
            args.addAll(scope);
        }
        sql.append(decided ? " ORDER BY a.decided_at DESC LIMIT 50" : " ORDER BY a.created_at ASC LIMIT 500");
        return jdbc.query(sql.toString(), (rs, i) -> toDto(rs), args.toArray());
    }

    /**
     * Approve or reject a proposal. Approving sets the employee's level for that
     * skill in the skill matrix (adding the skill if it's new). A rejection needs
     * a note so the employee knows why.
     */
    @Transactional
    public AssessmentDto decide(UUID tenantId, UUID id, DecideRequest req, Authentication auth, UUID actorUserId) {
        bindTenant(tenantId);
        String decision = validateDecision(req.decision(), req.note());
        String note = cleanNote(req.note());
        Row row = load(tenantId, id);
        UUID self = callerEmployeeId(auth);
        if (self != null && self.equals(row.employeeId())) {
            throw new AccessDeniedException("You can't decide your own skill level");
        }
        Set<UUID> scope = approverScope(auth);
        if (scope != null && !scope.contains(row.employeeId())) {
            throw new AccessDeniedException("This person isn't in your team");
        }
        if (!"PENDING".equals(row.status())) {
            throw new BusinessRuleException("This proposal has already been " + words(row.status()), "SKILL_ASSESSMENT_CLOSED");
        }

        UUID skillId = row.skillId();
        if ("APPROVED".equals(decision)) {
            skillId = applyToSkillMatrix(tenantId, row, actorUserId);
        }
        int n = jdbc.update("""
                UPDATE learning_mgmt.skill_assessments
                   SET status = ?, skill_id = ?, decided_by_employee_id = ?, decided_by_user_id = ?,
                       decided_at = now(), decision_note = ?, updated_at = now(), updated_by = ?,
                       version = version + 1
                 WHERE tenant_id = ? AND id = ? AND status = 'PENDING'
                """, decision, skillId, self, actorUserId, note, tag(actorUserId), tenantId, id);
        if (n == 0) {
            // Someone else decided it between our read and write.
            throw new BusinessRuleException("This proposal was just decided by someone else", "SKILL_ASSESSMENT_CLOSED");
        }
        String deciderName = self == null ? null : jdbc.query("""
                SELECT NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), '')
                  FROM hrms.employees WHERE tenant_id = ? AND id = ?
                """, rs -> rs.next() ? rs.getString(1) : null, tenantId, self);
        events.publishEvent(new SkillAssessmentDecidedEvent(id, row.employeeId(), tenantId,
                "APPROVED".equals(decision), row.skillName(), row.proposedLevel(), note, deciderName));
        log.info("Skill assessment {} {} by employee={} user={}", id, decision, self, actorUserId);
        return get(tenantId, id);
    }

    /** Sets the approved level on the employee's skill (case-insensitive name), creating it if new. */
    private UUID applyToSkillMatrix(UUID tenantId, Row row, UUID actorUserId) {
        UUID existing = jdbc.query("""
                SELECT id FROM learning_mgmt.employee_skills
                 WHERE tenant_id = ? AND employee_id = ? AND lower(skill_name) = lower(?)
                 ORDER BY updated_at DESC LIMIT 1
                """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                tenantId, row.employeeId(), row.skillName());
        if (existing != null) {
            jdbc.update("""
                    UPDATE learning_mgmt.employee_skills
                       SET proficiency = ?, updated_at = now(), updated_by = ?, version = version + 1
                     WHERE tenant_id = ? AND id = ?
                    """, row.proposedLevel(), tag(actorUserId), tenantId, existing);
            return existing;
        }
        return jdbc.queryForObject("""
                INSERT INTO learning_mgmt.employee_skills
                    (tenant_id, employee_id, skill_name, proficiency, certified, created_by, updated_by)
                VALUES (?, ?, ?, ?, FALSE, ?, ?)
                RETURNING id
                """, UUID.class, tenantId, row.employeeId(), row.skillName(), row.proposedLevel(),
                tag(actorUserId), tag(actorUserId));
    }

    // ── Scope and approver ────────────────────────────────────────────────────

    /**
     * Whose proposals the caller may decide: {@code null} = everyone (holders of
     * {@code hrms.learning.write}, i.e. HR), otherwise the caller's team.
     */
    Set<UUID> approverScope(Authentication auth) {
        if (hasAuthority(auth, "hrms.learning.write")) return null;
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt) || callerEmployeeId(auth) == null) return Set.of();
        try {
            return teamScope.resolve(jwt, null).stream().map(Employee::getId).collect(Collectors.toUnmodifiableSet());
        } catch (IllegalArgumentException noEmployee) {
            return Set.of();
        }
    }

    /**
     * The manager to ask: the head of the employee's department, else their
     * reporting manager when that manager heads no department (a department head's
     * team is their department, so a head of another department couldn't approve),
     * and only someone whose roles grant {@code hrms.learning.skill.approve}.
     * {@code null} sends the request to HR instead (see DomainEventListener).
     */
    UUID resolveApprover(UUID tenantId, UUID employeeId) {
        Object[] ref = jdbc.query("""
                SELECT d.department_head_employee_id, e.reporting_manager_id,
                       (SELECT count(*) FROM hrms.departments hd
                         WHERE hd.tenant_id = e.tenant_id
                           AND hd.department_head_employee_id = e.reporting_manager_id) AS manager_heads
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ?
                """, rs -> rs.next() ? new Object[] {
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getLong(3) } : null,
                tenantId, employeeId);
        if (ref == null) return null;
        UUID candidate = pickApprover(employeeId, (UUID) ref[0], (UUID) ref[1], (Long) ref[2]);
        if (candidate == null) return null;
        Boolean canApprove = jdbc.query("""
                SELECT EXISTS (
                    SELECT 1 FROM auth.user_credentials uc
                      JOIN rbac.user_roles ur ON ur.user_id = uc.id
                      JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                     WHERE uc.tenant_id = ? AND uc.employee_id = ? AND uc.is_active
                       AND rp.permission_code IN ('hrms.learning.skill.approve'))
                """, rs -> rs.next() && rs.getBoolean(1), tenantId, candidate);
        return Boolean.TRUE.equals(canApprove) ? candidate : null;
    }

    static UUID pickApprover(UUID employeeId, UUID departmentHead, UUID reportingManager, long managerHeadsDepartments) {
        if (departmentHead != null && !departmentHead.equals(employeeId)) return departmentHead;
        if (reportingManager != null && !reportingManager.equals(employeeId) && managerHeadsDepartments == 0) {
            return reportingManager;
        }
        return null;
    }

    // ── Validation (pure, unit-tested) ────────────────────────────────────────

    static String validateSkillName(String name) {
        String s = name == null ? "" : name.trim().replaceAll("\\s+", " ");
        if (s.isEmpty()) throw new BusinessRuleException("Name the skill", "SKILL_NAME_REQUIRED");
        if (s.length() > MAX_SKILL) {
            throw new BusinessRuleException("A skill name can be at most " + MAX_SKILL + " characters", "SKILL_NAME_TOO_LONG");
        }
        return s;
    }

    static int validateLevel(Integer level) {
        if (level == null || level < 1 || level > 5) {
            throw new BusinessRuleException("Pick a level from 1 to 5", "SKILL_LEVEL_INVALID");
        }
        return level;
    }

    static String validateDecision(String decision, String note) {
        String d = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
        if (!DECISIONS.contains(d)) {
            throw new BusinessRuleException("Decision must be APPROVED or REJECTED", "INVALID_DECISION");
        }
        if ("REJECTED".equals(d) && cleanNote(note) == null) {
            throw new BusinessRuleException("Add a note saying why, so the employee knows what to work on",
                    "DECISION_NOTE_REQUIRED");
        }
        return d;
    }

    static String cleanNote(String note) {
        if (note == null) return null;
        String t = note.trim();
        if (t.isEmpty()) return null;
        if (t.length() > MAX_NOTE) {
            throw new BusinessRuleException("A note can be at most " + MAX_NOTE + " characters", "NOTE_TOO_LONG");
        }
        return t;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static final String SELECT = """
            SELECT a.*,
                   TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS employee_name,
                   e.employee_code, d.name AS department,
                   NULLIF(TRIM(COALESCE(dm.first_name,'') || ' ' || COALESCE(dm.last_name,'')), '') AS decided_by_name
              FROM learning_mgmt.skill_assessments a
              LEFT JOIN hrms.employees e  ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
              LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
              LEFT JOIN hrms.employees dm ON dm.id = a.decided_by_employee_id AND dm.tenant_id = a.tenant_id
            """;

    private record Row(UUID employeeId, UUID skillId, String skillName, int proposedLevel, String status) {}

    private Row load(UUID tenantId, UUID id) {
        Row row = jdbc.query("""
                SELECT employee_id, skill_id, skill_name, proposed_proficiency, status
                  FROM learning_mgmt.skill_assessments WHERE tenant_id = ? AND id = ? FOR UPDATE
                """, rs -> rs.next() ? new Row(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getString(3), rs.getInt(4), rs.getString(5)) : null, tenantId, id);
        if (row == null) throw new ResourceNotFoundException("Skill assessment", id);
        return row;
    }

    private AssessmentDto get(UUID tenantId, UUID id) {
        List<AssessmentDto> rows = jdbc.query(SELECT + " WHERE a.tenant_id = ? AND a.id = ?",
                (rs, i) -> toDto(rs), tenantId, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Skill assessment", id);
        return rows.get(0);
    }

    private static AssessmentDto toDto(ResultSet rs) throws SQLException {
        int cur = rs.getInt("current_proficiency");
        Integer current = rs.wasNull() ? null : cur;
        String name = rs.getString("employee_name");
        return new AssessmentDto(
                rs.getObject("id", UUID.class),
                rs.getObject("employee_id", UUID.class),
                name == null || name.isBlank() ? null : name,
                rs.getString("employee_code"),
                rs.getString("department"),
                rs.getObject("skill_id", UUID.class),
                rs.getString("skill_name"),
                current,
                rs.getInt("proposed_proficiency"),
                rs.getString("employee_note"),
                rs.getString("status"),
                rs.getString("decided_by_name"),
                ts(rs.getTimestamp("decided_at")),
                rs.getString("decision_note"),
                ts(rs.getTimestamp("created_at")));
    }

    private static String words(String status) {
        return switch (status == null ? "" : status) {
            case "APPROVED" -> "approved";
            case "REJECTED" -> "rejected";
            case "WITHDRAWN" -> "withdrawn";
            default -> "decided";
        };
    }

    static boolean hasAuthority(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    static UUID callerEmployeeId(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return null;
        String claim = jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try { return UUID.fromString(claim.trim()); } catch (IllegalArgumentException e) { return null; }
    }

    private static String tag(UUID actor) {
        return actor == null ? null : actor.toString();
    }

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
