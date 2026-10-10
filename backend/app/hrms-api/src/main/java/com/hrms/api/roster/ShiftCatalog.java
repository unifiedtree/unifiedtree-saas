package com.hrms.api.roster;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * The shift definitions a roster refers to: {@code attendance.shift_policies}, the only shift catalog
 * (design §0.3; {@code org.shifts} is not used). Read only: the planner never changes a shift.
 */
@Component
public class ShiftCatalog {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    /** One shift as the planner shows it. */
    public record Shift(UUID id, UUID companyId, String code, String name, LocalTime start, LocalTime end,
                        String shiftType, boolean active) {

        /** The roster cell code: the shift's code, else its name's first letters (design §0.3). */
        public String label() {
            return label(code, name);
        }

        /** A night shift: type NIGHT, or one that ends at or before it starts (it crosses midnight). */
        public boolean night() {
            return "NIGHT".equalsIgnoreCase(shiftType) || (start != null && end != null && !end.isAfter(start));
        }

        public String startText() {
            return start == null ? null : start.format(HH_MM);
        }

        public String endText() {
            return end == null ? null : end.format(HH_MM);
        }

        /** "B (Evening, 14:00–22:00)". */
        public String describe() {
            String times = start != null && end != null ? ", " + startText() + "–" + endText() : "";
            return label() + " (" + (name == null ? "" : name) + times + ")";
        }

        static String label(String code, String name) {
            if (code != null && !code.isBlank()) return code.trim();
            if (name == null || name.isBlank()) return "?";
            StringBuilder out = new StringBuilder();
            for (String word : name.trim().split("[^\\p{L}\\p{N}]+")) {
                if (word.isEmpty()) continue;
                out.append(word.charAt(0));
                if (out.length() == 3) break;
            }
            return out.length() == 0 ? "?" : out.toString().toUpperCase(Locale.ROOT);
        }
    }

    private static final String SELECT = "SELECT id, company_id, code, name, start_time, end_time, shift_type, is_active "
            + "FROM attendance.shift_policies ";

    private final JdbcTemplate jdbc;

    public ShiftCatalog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Every shift of the company, active or not, by id (in name order). */
    public Map<UUID, Shift> ofCompany(UUID tenantId, UUID companyId) {
        Map<UUID, Shift> out = new LinkedHashMap<>();
        jdbc.query(SELECT + "WHERE tenant_id = ? AND company_id = ? ORDER BY name, id",
                (RowCallbackHandler) rs -> put(out, rs), tenantId, companyId);
        return out;
    }

    /** The shifts with these ids in the tenant, active or not. */
    public Map<UUID, Shift> byIds(UUID tenantId, Collection<UUID> ids) {
        Map<UUID, Shift> out = new LinkedHashMap<>();
        if (ids == null || ids.isEmpty()) return out;
        jdbc.query(SELECT + "WHERE tenant_id = ? AND id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> put(out, rs), tenantId, PlannerScopeService.uuidArray(ids));
        return out;
    }

    private static void put(Map<UUID, Shift> out, ResultSet rs) throws SQLException {
        Time s = rs.getTime("start_time"), e = rs.getTime("end_time");
        Shift shift = new Shift(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                rs.getString("code"), rs.getString("name"), s == null ? null : s.toLocalTime(),
                e == null ? null : e.toLocalTime(), rs.getString("shift_type"), rs.getBoolean("is_active"));
        out.put(shift.id(), shift);
    }
}
