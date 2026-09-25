package com.hrms.app.reports;

import com.hrms.core.exception.ResourceNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * An employee's employment status over time (hrms.employee_status_history,
 * V143_27): each status and the date it took effect. The table is written by a
 * database trigger on every status change, so this is read-only. Same
 * permission as the directory record itself.
 */
@RestController
@RequestMapping("/v1/hrms/employees")
@Tag(name = "Employee status history")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeStatusHistoryController {

    private final JdbcTemplate jdbc;

    public EmployeeStatusHistoryController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/{id}/status-history")
    @Operation(summary = "Employment status changes of one employee, oldest first")
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> history(@PathVariable UUID id) {
        if (jdbc.queryForList("SELECT 1 FROM hrms.employees WHERE id = ?", Integer.class, id).isEmpty()) {
            throw new ResourceNotFoundException("Employee not found");
        }
        return jdbc.query("""
                SELECT from_status, status, effective_on, source, recorded_at
                  FROM hrms.employee_status_history
                 WHERE employee_id = ?
                 ORDER BY effective_on, recorded_at
                """, (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("fromStatus", rs.getString("from_status"));
            m.put("status", rs.getString("status"));
            m.put("effectiveOn", rs.getDate("effective_on").toLocalDate().toString());
            m.put("source", rs.getString("source"));
            m.put("recordedAt", rs.getTimestamp("recorded_at").toInstant().toString());
            return m;
        }, id);
    }
}
