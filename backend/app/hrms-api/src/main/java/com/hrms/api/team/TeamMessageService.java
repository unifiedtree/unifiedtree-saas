package com.hrms.api.team;

import com.hrms.api.approvals.Callers;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * "Message team" (redesign BW-12, DECISIONS 16): a person with
 * {@code hrms.team.message} posts a short message to their own team, and each
 * member is told in the app and on the phone (TEAM_MESSAGE); members see it in
 * their Around you.
 *
 * <p>The team is the My team rule on its own ({@link TeamEmployeeScope#teamOf}):
 * the departments the sender heads and their direct reports, never the
 * sender, never people who have left. A company-wide permission does not
 * widen it: company announcements are company notices.
 *
 * <p>hrms.team_messages and hrms.team_message_recipients (V143.55) are read and
 * written with JDBC only; while they are missing every endpoint answers
 * FEATURE_NOT_READY.
 */
@Service
public class TeamMessageService {

    private static final Logger log = LoggerFactory.getLogger(TeamMessageService.class);
    public static final int BODY_MAX = 500;
    static final int LIST_LIMIT = 100;

    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope teamScope;
    private final EmployeeRepository employees;
    private final WorkforceDepartmentRepository departments;
    private final AuditService audit;
    private final ApplicationEventPublisher events;

    public TeamMessageService(JdbcTemplate jdbc, TeamEmployeeScope teamScope, EmployeeRepository employees,
                              WorkforceDepartmentRepository departments, AuditService audit,
                              ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.teamScope = teamScope;
        this.employees = employees;
        this.departments = departments;
        this.audit = audit;
        this.events = events;
    }

    public record TeamMessage(UUID id, String body, UUID senderEmployeeId, String senderName, String teamLabel,
                              Instant createdAt, Integer recipientCount) {
    }

    /** The trimmed body, or a 400 when it is empty or longer than 500 characters. */
    static String validBody(String body) {
        String b = body == null ? "" : body.strip();
        if (b.isEmpty()) {
            throw new HrmsException("Write a message first.", HttpStatus.BAD_REQUEST, "TEAM_MESSAGE_EMPTY");
        }
        if (b.length() > BODY_MAX) {
            throw new HrmsException("Keep the message to " + BODY_MAX + " characters.", HttpStatus.BAD_REQUEST, "TEAM_MESSAGE_TOO_LONG");
        }
        return b;
    }

    /** The sender's team: teamOf, without people who have left. */
    List<Employee> recipients(Employee sender) {
        return teamScope.teamOf(sender).stream()
                .filter(e -> e.getEmploymentStatus() == null || !TeamReadService.LEFT.contains(e.getEmploymentStatus()))
                .filter(e -> !e.getId().equals(sender.getId()))
                .toList();
    }

    @Transactional
    public TeamMessage post(String rawBody, Jwt jwt) {
        String body = validBody(rawBody);
        UUID tenantId = TenantContext.requireTenantId();
        requireTables();
        UUID senderId = Callers.employeeId(jwt);
        Employee sender = employees.findById(senderId).orElseThrow(() -> new HrmsException(
                "You need an employee record to message a team.", HttpStatus.UNPROCESSABLE_ENTITY, "NO_EMPLOYEE_RECORD"));
        List<Employee> team = recipients(sender);
        if (team.isEmpty()) {
            throw new HrmsException("There is no one in your team to message yet.", HttpStatus.UNPROCESSABLE_ENTITY, "TEAM_EMPTY");
        }
        String teamLabel = departments.findByDepartmentHeadEmployeeId(senderId).stream()
                .map(Department::getName).filter(Objects::nonNull).sorted().reduce((a, b) -> a + ", " + b).orElse(null);
        String senderName = TeamReadService.name(sender);

        UUID id = UUID.randomUUID();
        Instant createdAt = FeatureNotReady.guard(() -> jdbc.queryForObject("""
                INSERT INTO hrms.team_messages (id, tenant_id, sender_employee_id, sender_user_id, body, team_label, recipient_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING created_at
                """, Timestamp.class, id, tenantId, senderId, TenantContext.getUserId(), body, teamLabel, team.size()))
                .toInstant();
        List<UUID> recipientIds = team.stream().map(Employee::getId).toList();
        FeatureNotReady.run(() -> jdbc.batchUpdate(
                "INSERT INTO hrms.team_message_recipients (tenant_id, message_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                new BatchPreparedStatementSetter() {
                    @Override
                    public void setValues(PreparedStatement ps, int i) throws SQLException {
                        ps.setObject(1, tenantId);
                        ps.setObject(2, id);
                        ps.setObject(3, recipientIds.get(i));
                    }

                    @Override
                    public int getBatchSize() {
                        return recipientIds.size();
                    }
                }));
        try {
            audit.record("hrms", "TEAM_MESSAGE_SENT", "team_message", id, senderName + " sent a message to "
                    + recipientIds.size() + (recipientIds.size() == 1 ? " person" : " people")
                    + (teamLabel != null ? " in " + teamLabel : " in their team") + ".");
        } catch (Exception e) {
            log.warn("Audit of a team message failed (non-fatal): {}", e.getMessage());
        }
        events.publishEvent(new TeamMessagePostedEvent(tenantId, id, recipientIds, senderName, body, teamLabel));
        return new TeamMessage(id, body, senderId, senderName, teamLabel, createdAt, recipientIds.size());
    }

    /** Messages sent to the caller in the last {@code days} days, newest first. */
    @Transactional(readOnly = true)
    public List<TeamMessage> mine(int days, Jwt jwt) {
        if (days < 1 || days > 365) {
            throw new HrmsException("Choose between 1 and 365 days.", HttpStatus.BAD_REQUEST, "TEAM_MESSAGE_RANGE_INVALID");
        }
        UUID tenantId = TenantContext.requireTenantId();
        requireTables();
        return FeatureNotReady.guard(() -> jdbc.query("""
                SELECT m.id, m.body, m.sender_employee_id, m.team_label, m.created_at, NULL::int AS recipient_count,
                       NULLIF(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), '') AS sender_name
                  FROM hrms.team_message_recipients r
                  JOIN hrms.team_messages m ON m.tenant_id = r.tenant_id AND m.id = r.message_id
                  LEFT JOIN hrms.employees s ON s.id = m.sender_employee_id AND s.tenant_id = m.tenant_id
                 WHERE r.tenant_id = ? AND r.employee_id = ? AND m.created_at >= now() - make_interval(days => ?)
                 ORDER BY m.created_at DESC
                 LIMIT ?
                """, MESSAGE, tenantId, Callers.employeeId(jwt), days, LIST_LIMIT));
    }

    /** Messages the caller sent, newest first, with how many people each went to. */
    @Transactional(readOnly = true)
    public List<TeamMessage> sent(Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        requireTables();
        return FeatureNotReady.guard(() -> jdbc.query("""
                SELECT m.id, m.body, m.sender_employee_id, m.team_label, m.created_at, m.recipient_count,
                       NULLIF(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), '') AS sender_name
                  FROM hrms.team_messages m
                  LEFT JOIN hrms.employees s ON s.id = m.sender_employee_id AND s.tenant_id = m.tenant_id
                 WHERE m.tenant_id = ? AND m.sender_employee_id = ?
                 ORDER BY m.created_at DESC
                 LIMIT ?
                """, MESSAGE, tenantId, Callers.employeeId(jwt), LIST_LIMIT));
    }

    /** Both tables must exist (V143.55); otherwise the feature isn't switched on yet. */
    private void requireTables() {
        Boolean ready = jdbc.queryForObject(
                "SELECT to_regclass('hrms.team_messages') IS NOT NULL AND to_regclass('hrms.team_message_recipients') IS NOT NULL",
                Boolean.class);
        if (!Boolean.TRUE.equals(ready)) throw new FeatureNotReady();
    }

    private static final RowMapper<TeamMessage> MESSAGE = (rs, n) -> new TeamMessage(
            rs.getObject("id", UUID.class), rs.getString("body"), rs.getObject("sender_employee_id", UUID.class),
            Objects.requireNonNullElse(rs.getString("sender_name"), "Your manager"), rs.getString("team_label"),
            rs.getTimestamp("created_at").toInstant(), (Integer) rs.getObject("recipient_count"));
}
