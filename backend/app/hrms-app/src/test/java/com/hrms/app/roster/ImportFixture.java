package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.plan.PlanFacts;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CreationHelper;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A small company for the import tests: departments Technical and Admin, buildings 1 and 2, shifts A, B, C (night),
 * G and a deleted N, people with codes, and January 2027 (31 days; 26 Jan is a holiday when the test says so).
 * Workbooks are built in the test with Apache POI, the way the client's file would be.
 */
final class ImportFixture {

    static final UUID COMPANY = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    static final UUID OTHER_COMPANY = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    static final UUID TECHNICAL = UUID.fromString("dddddddd-0000-0000-0000-000000000001");
    static final UUID ADMIN = UUID.fromString("dddddddd-0000-0000-0000-000000000002");
    static final UUID BUILDING_1 = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    static final UUID BUILDING_2 = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000002");
    static final UUID HVAC = UUID.fromString("eeeeeeee-0000-0000-0000-000000000001");
    static final UUID ELECTRICIAN = UUID.fromString("eeeeeeee-0000-0000-0000-000000000002");

    static final LocalDate JAN_1 = LocalDate.of(2027, 1, 1);
    static final LocalDate JAN_31 = LocalDate.of(2027, 1, 31);

    static final PlanFacts.Shift A = shift("A", "Morning", "06:00", "14:00", "FIXED", true);
    static final PlanFacts.Shift B = shift("B", "Evening", "14:00", "22:00", "FIXED", true);
    static final PlanFacts.Shift C = shift("C", "Night", "22:00", "06:00", "NIGHT", true);
    static final PlanFacts.Shift G = shift("G", "General", "09:00", "18:00", "FIXED", true);
    static final PlanFacts.Shift N = shift("N", "Old night", "21:00", "05:00", "NIGHT", false);

    static final PlannerPerson RAVI = person("Ravi Kumar", "TV-101", TECHNICAL, "Technical", HVAC, "HVAC Technician", BUILDING_1, "Building 1");
    static final PlannerPerson PRAVEEN = person("Praveen Rao", "TV-102", TECHNICAL, "Technical", HVAC, "HVAC Technician", BUILDING_1, "Building 1");
    static final PlannerPerson SHIVA = person("Shiva Prasad", "TV-103", TECHNICAL, "Technical", ELECTRICIAN, "Electrician", BUILDING_2, "Building 2");
    static final PlannerPerson ANITHA = person("Anitha Reddy", "TV-104", TECHNICAL, "Technical", ELECTRICIAN, "Electrician", BUILDING_2, "Building 2");
    static final PlannerPerson KIRAN = person("Kiran Babu", "TV-105", TECHNICAL, "Technical", null, null, BUILDING_1, "Building 1");
    static final PlannerPerson LAKSHMI = person("Lakshmi Devi", "TV-106", TECHNICAL, "Technical", null, null, BUILDING_2, "Building 2");
    /** In Admin, not Technical. */
    static final PlannerPerson MEERA = person("Meera Nair", "AD-201", ADMIN, "Admin", null, null, BUILDING_1, "Building 1");
    /** Two people share this name, in different departments. */
    static final PlannerPerson RAJ_TECH = person("Raj Kumar", "TV-107", TECHNICAL, "Technical", HVAC, "HVAC Technician", BUILDING_1, "Building 1");
    static final PlannerPerson RAJ_ADMIN = person("Raj Kumar", "AD-202", ADMIN, "Admin", null, null, BUILDING_1, "Building 1");

    static List<PlannerPerson> everyone() {
        return List.of(RAVI, PRAVEEN, SHIVA, ANITHA, KIRAN, LAKSHMI, MEERA, RAJ_TECH, RAJ_ADMIN);
    }

    private ImportFixture() {}

    static PlanFacts.Shift shift(String code, String name, String start, String end, String type, boolean active) {
        return new PlanFacts.Shift(UUID.nameUUIDFromBytes(("shift-" + code).getBytes(StandardCharsets.UTF_8)), COMPANY, code, name,
                LocalTime.parse(start), LocalTime.parse(end), type, active);
    }

    static PlannerPerson person(String name, String code, UUID dept, String deptName, UUID desig, String desigName,
                                UUID branch, String branchName) {
        return new PlannerPerson(UUID.nameUUIDFromBytes(("person-" + code).getBytes(StandardCharsets.UTF_8)), name, code,
                desig, desigName, dept, deptName, branch, branchName, LocalDate.of(2024, 4, 1), null, List.of());
    }

    static final UUID SUPERVISOR = UUID.fromString("eeeeeeee-0000-0000-0000-000000000003");

    static PlannerPerson withDesignation(PlannerPerson p, UUID designationId, String designationName) {
        return new PlannerPerson(p.employeeId(), p.name(), p.code(), designationId, designationName, p.departmentId(),
                p.departmentName(), p.branchId(), p.branchName(), p.joinedOn(), p.lastWorkingDay(), List.of());
    }

    static PlannerPerson withDates(PlannerPerson p, LocalDate joined, LocalDate lastDay) {
        return new PlannerPerson(p.employeeId(), p.name(), p.code(), p.designationId(), p.designationName(), p.departmentId(),
                p.departmentName(), p.branchId(), p.branchName(), joined, lastDay, List.of());
    }

    /** Planning facts: the fixture's shifts, these people, and the holidays and leave given. */
    static PlanFacts facts(List<PlannerPerson> people, Map<LocalDate, String> holidays, Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave,
                           PlanFacts.Shift... extraShifts) {
        Map<UUID, PlanFacts.Shift> shifts = new LinkedHashMap<>();
        for (PlanFacts.Shift s : List.of(A, B, C, G, N)) shifts.put(s.id(), s);
        for (PlanFacts.Shift s : extraShifts) shifts.put(s.id(), s);
        Map<UUID, PlanFacts.Person> persons = new HashMap<>();
        for (PlannerPerson p : people) {
            persons.put(p.employeeId(), new PlanFacts.Person(p.employeeId(), COMPANY, p.name(), p.code(), p.designationId(),
                    p.designationName(), p.departmentId(), p.departmentName(), p.branchId(), p.branchName(), p.joinedOn(),
                    p.lastWorkingDay()));
        }
        return new PlanFacts(COMPANY, shifts, persons, Map.of(), holidays, leave, Map.of(), List.of(),
                Map.of(HVAC, "HVAC Technician", ELECTRICIAN, "Electrician"), Map.of(TECHNICAL, "Technical", ADMIN, "Admin"),
                Map.of(BUILDING_1, "Building 1", BUILDING_2, "Building 2"), PlanFacts.DEFAULT_MIN_REST_MINUTES, null);
    }

    static PlanFacts facts(List<PlannerPerson> people) {
        return facts(people, Map.of(), Map.of());
    }

    static PlanFacts.Leave leave(boolean halfDay) {
        return new PlanFacts.Leave(OverlayType.L, "Casual leave", halfDay);
    }

    static PlanFacts.Leave compOff() {
        return new PlanFacts.Leave(OverlayType.COFF, "Comp off", false);
    }

    /** A company-wide planner's target: January 2027, Technical, any building. */
    static RosterImportCheck.Target technical() {
        return new RosterImportCheck.Target(COMPANY, JAN_1, JAN_31, TECHNICAL, "Technical", null, null, true, Set.of());
    }

    static RosterImportCheck.Target target(UUID dept, String deptName, UUID branch, String branchName, boolean companyWide, Set<UUID> headed) {
        return new RosterImportCheck.Target(COMPANY, JAN_1, JAN_31, dept, deptName, branch, branchName, companyWide, headed);
    }

    // ── sheets ───────────────────────────────────────────────────────────────

    /** The S13 header for January: Employee | Employee code | Department | Designation | Building | 01..31 | totals. */
    static List<Object> januaryHeader() {
        List<Object> h = new ArrayList<>(List.of("Employee", "Employee code", "Department", "Designation", "Building"));
        for (int d = 1; d <= 31; d++) h.add(String.format("%02d", d));
        h.addAll(List.of("Working days", "WO", "PH", "L", "COFF"));
        return h;
    }

    /** One person row for {@link #januaryHeader()}: identity, then codes by day number (1-based), then no totals. */
    static List<Object> januaryRow(PlannerPerson p, Map<Integer, String> codes) {
        List<Object> r = new ArrayList<>(List.of(p.name(), p.code(), p.departmentName(), p.designationName() == null ? "" : p.designationName(),
                p.branchName()));
        for (int d = 1; d <= 31; d++) r.add(codes.getOrDefault(d, ""));
        return r;
    }

    /** A sheet with a title row, the given header and rows (strings, numbers or LocalDates). */
    static List<List<Object>> sheet(List<Object> header, List<List<Object>> rows) {
        List<List<Object>> all = new ArrayList<>();
        all.add(List.of("Roster — January 2027 — Technical"));
        all.add(header);
        all.addAll(rows);
        return all;
    }

    /** An .xlsx workbook with one sheet; LocalDate values become real Excel dates, Numbers numbers. */
    static byte[] xlsx(String sheetName, List<List<Object>> rows) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet(sheetName);
            CreationHelper helper = wb.getCreationHelper();
            CellStyle date = wb.createCellStyle();
            date.setDataFormat(helper.createDataFormat().getFormat("d-mmm"));
            for (int r = 0; r < rows.size(); r++) {
                Row row = sheet.createRow(r);
                List<Object> values = rows.get(r);
                for (int c = 0; c < values.size(); c++) {
                    Object v = values.get(c);
                    if (v == null) continue;
                    if (v instanceof LocalDate d) {
                        row.createCell(c).setCellValue(d);
                        row.getCell(c).setCellStyle(date);
                    } else if (v instanceof Number n) {
                        row.createCell(c).setCellValue(n.doubleValue());
                    } else if (!v.toString().isEmpty()) {
                        row.createCell(c).setCellValue(v.toString());
                    }
                }
            }
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static byte[] xlsx(List<List<Object>> rows) {
        return xlsx("Roster", rows);
    }

    /** The same rows as CSV text (UTF-8). */
    static byte[] csv(List<List<Object>> rows) {
        StringBuilder b = new StringBuilder();
        for (List<Object> row : rows) {
            List<String> cells = new ArrayList<>();
            for (Object v : row) {
                String s = v == null ? "" : v.toString();
                cells.add(s.contains(",") || s.contains("\"") ? "\"" + s.replace("\"", "\"\"") + "\"" : s);
            }
            b.append(String.join(",", cells)).append("\r\n");
        }
        return b.toString().getBytes(StandardCharsets.UTF_8);
    }

    static RosterSheetParser.ParsedSheet parse(List<List<Object>> rows) {
        return RosterSheetParser.parse("roster.xlsx", xlsx(rows), JAN_1, JAN_31);
    }
}
