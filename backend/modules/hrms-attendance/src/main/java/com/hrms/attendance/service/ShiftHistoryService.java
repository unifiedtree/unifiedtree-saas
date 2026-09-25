package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.ShiftAssignmentHistoryItem;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Time;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * An employee's shift history: every assignment, newest first, with the shift,
 * the dates it covers, who made it and the note they left (V143.25). The
 * controller decides whose history the caller may read.
 */
@Service
public class ShiftHistoryService {

    /** Most assignments returned; a person rarely has more than a handful. */
    static final int MAX_ROWS = 100;

    private final JdbcTemplate jdbc;

    public ShiftHistoryService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * {@code created_by} holds the login id of whoever made the assignment
     * (Spring auditing); it is shown as that person's name, else the login's
     * display name or email.
     */
    static final String SQL = """
            SELECT a.id, a.shift_policy_id, s.name AS shift_name, s.start_time, s.end_time,
                   a.effective_from, a.effective_to, a.note, a.created_at,
                   COALESCE(NULLIF(concat_ws(' ', e.first_name, e.last_name), ''), uc.display_name, uc.email) AS set_by
              FROM attendance.employee_shift_assignments a
              LEFT JOIN attendance.shift_policies s ON s.id = a.shift_policy_id AND s.tenant_id = a.tenant_id
              LEFT JOIN auth.user_credentials uc ON uc.id::text = a.created_by AND uc.tenant_id = a.tenant_id
              LEFT JOIN hrms.employees e ON e.id = uc.employee_id AND e.tenant_id = a.tenant_id
             WHERE a.tenant_id = ? AND a.employee_id = ?
             ORDER BY a.effective_from DESC, a.created_at DESC
             LIMIT\s""" + MAX_ROWS;

    static final RowMapper<ShiftAssignmentHistoryItem> MAPPER = (rs, n) -> {
        Time start = rs.getTime("start_time");
        Time end = rs.getTime("end_time");
        Timestamp at = rs.getTimestamp("created_at");
        return new ShiftAssignmentHistoryItem(
                rs.getObject("id", UUID.class),
                rs.getObject("shift_policy_id", UUID.class),
                rs.getString("shift_name"),
                start == null ? null : start.toLocalTime(),
                end == null ? null : end.toLocalTime(),
                rs.getObject("effective_from", LocalDate.class),
                rs.getObject("effective_to", LocalDate.class),
                rs.getString("note"),
                rs.getString("set_by"),
                at == null ? null : at.toInstant());
    };

    @Transactional(readOnly = true)
    public List<ShiftAssignmentHistoryItem> history(UUID employeeId) {
        return jdbc.query(SQL, MAPPER, TenantContext.getTenantId(), employeeId);
    }
}
