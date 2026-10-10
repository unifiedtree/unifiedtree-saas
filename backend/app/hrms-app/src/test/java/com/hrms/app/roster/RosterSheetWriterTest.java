package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.Overlay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlanCell;
import com.hrms.api.roster.RosterContract.PlanRow;
import com.hrms.api.roster.RosterContract.RowTotals;
import com.hrms.api.roster.plan.PlanFacts;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static com.hrms.app.roster.ImportFixture.A;
import static com.hrms.app.roster.ImportFixture.B;
import static com.hrms.app.roster.ImportFixture.C;
import static com.hrms.app.roster.ImportFixture.G;
import static com.hrms.app.roster.ImportFixture.JAN_1;
import static com.hrms.app.roster.ImportFixture.JAN_31;
import static com.hrms.app.roster.ImportFixture.KIRAN;
import static com.hrms.app.roster.ImportFixture.RAVI;
import static org.assertj.core.api.Assertions.assertThat;

/** The template and export layout (design §1.7 "Template"), and that what it writes reads back the same. */
class RosterSheetWriterTest {

    private static final List<RosterSheetWriter.SheetShift> SHIFTS = List.of(
            new RosterSheetWriter.SheetShift("A", "Morning", A.start(), A.end(), false),
            new RosterSheetWriter.SheetShift("B", "Evening", B.start(), B.end(), false),
            new RosterSheetWriter.SheetShift("C", "Night", C.start(), C.end(), true),
            new RosterSheetWriter.SheetShift("G", "General", G.start(), G.end(), false));

    private static RosterSheetWriter.SheetPerson person(com.hrms.api.roster.RosterContract.PlannerPerson p, String... codes) {
        List<String> all = new ArrayList<>(Arrays.asList(new String[31]));
        for (int i = 0; i < codes.length; i++) all.set(i, codes[i]);
        return new RosterSheetWriter.SheetPerson(p.name(), p.code(), p.departmentName(), p.designationName(), p.branchName(), all);
    }

    private static XSSFWorkbook read(byte[] bytes) throws IOException {
        return new XSSFWorkbook(new ByteArrayInputStream(bytes));
    }

    private static String text(Row row, int c) {
        var cell = row.getCell(c);
        return cell == null ? "" : cell.getCellType() == CellType.STRING ? cell.getStringCellValue() : cell.toString();
    }

    @Test
    void theTemplateHasTheS13Layout() throws IOException {
        byte[] bytes = RosterSheetWriter.write(new RosterSheetWriter.Spec("Roster — January 2027 — Technical", JAN_1, JAN_31, SHIFTS,
                List.of("Flexible"), Map.of(LocalDate.of(2027, 1, 26), "Republic Day"), List.of(person(RAVI), person(KIRAN)), 50));

        try (XSSFWorkbook wb = read(bytes)) {
            assertThat(wb.getNumberOfSheets()).isEqualTo(2);
            Sheet roster = wb.getSheet("Roster");
            assertThat(wb.getSheetName(0)).isEqualTo("Roster");
            assertThat(text(roster.getRow(0), 0)).isEqualTo("Roster — January 2027 — Technical");

            Row header = roster.getRow(1);
            List<String> headers = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) headers.add(text(header, c));
            List<String> expected = new ArrayList<>(List.of("Employee", "Employee code", "Department", "Designation", "Building"));
            for (int d = 1; d <= 31; d++) expected.add(String.format("%02d", d));
            expected.addAll(List.of("Working days", "WO", "PH", "L", "COFF"));
            assertThat(headers).isEqualTo(expected);

            Row weekdays = roster.getRow(2);
            assertThat(text(weekdays, 5)).isEqualTo("F");   // 1 Jan 2027 is a Friday
            assertThat(text(weekdays, 8)).isEqualTo("M");

            Row ravi = roster.getRow(3);
            assertThat(List.of(text(ravi, 0), text(ravi, 1), text(ravi, 2), text(ravi, 3), text(ravi, 4)))
                    .containsExactly("Ravi Kumar", "TV-101", "Technical", "HVAC Technician", "Building 1");
            assertThat(ravi.getCell(5).getCellType()).isEqualTo(CellType.BLANK);
            assertThat(ravi.getCell(36).getCellFormula()).isEqualTo("COUNTA(F4:AJ4)-AL4-AM4-AN4-AO4");
            assertThat(ravi.getCell(37).getCellFormula()).isEqualTo("COUNTIF(F4:AJ4,\"WO\")+COUNTIF(F4:AJ4,\"W/O\")+COUNTIF(F4:AJ4,\"OFF\")");
            assertThat(ravi.getCell(40).getCellFormula()).isEqualTo("COUNTIF(F4:AJ4,\"COFF\")+COUNTIF(F4:AJ4,\"CO\")+COUNTIF(F4:AJ4,\"C-OFF\")");
            assertThat(ravi.getCell(36).getNumericCellValue()).isZero();   // worked out, not left for Excel
            assertThat(roster.getRow(5)).isNull();                         // spare rows hold only the drop-down

            List<? extends DataValidation> validations = roster.getDataValidations();
            assertThat(validations).hasSize(1);
            CellRangeAddress area = validations.get(0).getRegions().getCellRangeAddress(0);
            assertThat(area.formatAsString()).isEqualTo("F4:AJ55");
            assertThat(validations.get(0).getValidationConstraint().getFormula1()).isEqualTo("Codes!$A$2:$A$9");

            Sheet codes = wb.getSheet("Codes");
            List<String> listed = new ArrayList<>();
            for (int r = 1; r <= 8; r++) listed.add(text(codes.getRow(r), 0));
            assertThat(listed).containsExactly("A", "B", "C", "G", "WO", "PH", "L", "COFF");
            assertThat(text(codes.getRow(3), 1)).startsWith("Night (night shift");
            assertThat(text(codes.getRow(3), 2)).isEqualTo("22:00");
            assertThat(text(codes.getRow(5), 1)).isEqualTo("Weekly off (also W/O, OFF)");
            List<String> notes = new ArrayList<>();
            for (int r = 9; r <= codes.getLastRowNum(); r++) if (codes.getRow(r) != null) notes.add(text(codes.getRow(r), 1));
            assertThat(notes).contains("Flexible");
        }
    }

    @Test
    void aRangeUsesDateHeaders() throws IOException {
        LocalDate start = LocalDate.of(2026, 10, 15), end = LocalDate.of(2026, 11, 14);
        byte[] bytes = RosterSheetWriter.write(new RosterSheetWriter.Spec("Roster", start, end, SHIFTS, List.of(), Map.of(), List.of(), 0));
        try (XSSFWorkbook wb = read(bytes)) {
            Row header = wb.getSheet("Roster").getRow(1);
            assertThat(text(header, 5)).isEqualTo("15 Oct");
            assertThat(text(header, 22)).isEqualTo("01 Nov");
            assertThat(text(header, 35)).isEqualTo("14 Nov");
            assertThat(text(header, 36)).isEqualTo("Working days");
        }
        // and the parser reads them back as the range's dates
        RosterSheetParser.ParsedSheet s = RosterSheetParser.parse("r.xlsx", bytes, start, end);
        assertThat(s.dayByDate()).hasSize(31);
        assertThat(s.notes()).isEmpty();
    }

    @Test
    void whatTheWriterWritesImportsBackTheSame() {
        String[] ravi = {"A", "A", "B", "B", "C", "C", "WO", "PH", "L", "COFF", "G", null, "W/O"};
        byte[] bytes = RosterSheetWriter.write(new RosterSheetWriter.Spec("Roster", JAN_1, JAN_31, SHIFTS, List.of(),
                Map.of(), List.of(person(RAVI, ravi), person(KIRAN)), 0));

        RosterSheetParser.ParsedSheet s = RosterSheetParser.parse("export.xlsx", bytes, JAN_1, JAN_31);
        assertThat(s.notes()).isEmpty();
        assertThat(s.rows()).hasSize(2);
        assertThat(s.rows().get(0).totals()).containsEntry(RosterSheetLayout.Total.WORKING, 7.0)
                .containsEntry(RosterSheetLayout.Total.WO, 2.0).containsEntry(RosterSheetLayout.Total.COFF, 1.0);

        var leave = Map.of(RAVI.employeeId(), Map.of(JAN_1.plusDays(8), ImportFixture.leave(false), JAN_1.plusDays(9), ImportFixture.compOff()));
        PlanFacts f = ImportFixture.facts(ImportFixture.everyone(), Map.of(JAN_1.plusDays(7), "A holiday"), leave);
        RosterImportCheck.Target t = ImportFixture.technical();
        RosterImportCheck.Outcome o = RosterImportCheck.cells(s, RosterImportCheck.match(s, ImportFixture.everyone(), t), f, t);
        assertThat(o.problems()).isEmpty();   // totals agree, every code known, PH/L/COFF backed by the calendar
        List<String> cells = o.cells().get(0).cells();
        assertThat(cells.subList(0, 13)).containsExactly(A.id().toString(), A.id().toString(), B.id().toString(), B.id().toString(),
                C.id().toString(), C.id().toString(), RosterContract.WO, null, null, null, G.id().toString(), null, RosterContract.WO);
    }

    @Test
    void anExportedRowShowsTheOverlayOnAnEmptyDay() {
        Overlay ph = new Overlay(OverlayType.PH, "Republic Day", false);
        Overlay coff = new Overlay(OverlayType.COFF, "Comp off", false);
        PlanRow row = new PlanRow(RAVI.employeeId(), "Ravi Kumar", "TV-101", null, null, null, null, 0, List.of(
                new PlanCell(A.id().toString(), "A", false, ph, false, List.of()),   // planned on a holiday: the shift
                new PlanCell(null, null, false, ph, false, List.of()),
                new PlanCell(null, null, false, coff, false, List.of()),
                new PlanCell("WO", "WO", false, null, false, List.of()),
                new PlanCell(null, null, false, ph, true, List.of()),               // after leaving: nothing
                new PlanCell(null, null, false, null, false, List.of())), new RowTotals(1, 1, 1, 1, 1));
        assertThat(RosterImportService.exportCodes(row)).containsExactly("A", "PH", "COFF", "WO", null, null);
    }
}
