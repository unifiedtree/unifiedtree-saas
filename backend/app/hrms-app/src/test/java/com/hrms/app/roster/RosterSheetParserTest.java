package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract.Level;
import com.hrms.app.roster.RosterSheetLayout.Column;
import com.hrms.app.roster.RosterSheetLayout.Total;
import com.hrms.app.roster.RosterSheetParser.Note;
import com.hrms.app.roster.RosterSheetParser.ParsedSheet;
import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.hrms.app.roster.ImportFixture.JAN_1;
import static com.hrms.app.roster.ImportFixture.JAN_31;
import static com.hrms.app.roster.ImportFixture.RAVI;
import static com.hrms.app.roster.ImportFixture.januaryHeader;
import static com.hrms.app.roster.ImportFixture.januaryRow;
import static com.hrms.app.roster.ImportFixture.sheet;
import static com.hrms.app.roster.ImportFixture.xlsx;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Reading the S13 layout (design §1.7 "Parser"): header row, synonyms, day columns, skipped rows, limits. */
class RosterSheetParserTest {

    private static final LocalDate NOV_1 = LocalDate.of(2026, 11, 1), NOV_30 = LocalDate.of(2026, 11, 30);

    @Test
    void readsTheOwnersLayoutWithATitleRowAndAWeekdayRow() {
        List<Object> weekdays = new ArrayList<>(List.of("", "", "", "", ""));
        for (int d = 1; d <= 31; d++) weekdays.add(RosterSheetParser.weekdayLetter(JAN_1.plusDays(d - 1)));
        List<List<Object>> rows = sheet(januaryHeader(), List.of(weekdays, januaryRow(RAVI, Map.of(1, "A", 2, "b", 31, "WO"))));

        ParsedSheet s = ImportFixture.parse(rows);

        assertThat(s.sheetName()).isEqualTo("Roster");
        assertThat(s.headerRow()).isEqualTo(2);
        assertThat(s.columns()).containsOnlyKeys(Column.values());
        assertThat(s.dayColumns()).hasSize(31);
        assertThat(s.dayByDate()).containsOnlyKeys(dates(JAN_1, JAN_31));
        assertThat(s.dayByDate().get(JAN_1).letter()).isEqualTo("F");
        assertThat(s.totalColumns()).containsOnlyKeys(Total.WORKING, Total.WO, Total.PH, Total.L, Total.COFF);
        assertThat(s.rows()).hasSize(1);   // the weekday row is skipped
        RosterSheetParser.SheetRow r = s.rows().get(0);
        assertThat(r.rowNo()).isEqualTo(4);
        assertThat(r.employee()).isEqualTo("Ravi Kumar");
        assertThat(r.code()).isEqualTo("TV-101");
        assertThat(r.department()).isEqualTo("Technical");
        assertThat(r.building()).isEqualTo("Building 1");
        assertThat(r.cells()).containsExactly(Map.entry(JAN_1, "A"), Map.entry(JAN_1.plusDays(1), "b"), Map.entry(JAN_31, "WO"));
        assertThat(s.notes()).isEmpty();
    }

    @Test
    void headerSynonymsAndMissingOptionalColumns() {
        List<Object> header = new ArrayList<>(List.of("Name", "Emp code", "Category", "Branch"));
        for (int d = 1; d <= 31; d++) header.add(d);   // day numbers as Excel numbers
        List<List<Object>> rows = new ArrayList<>();
        rows.add(header);
        rows.add(List.of("Ravi Kumar", "TV-101", "HVAC Technician", "Building 1", "A"));

        ParsedSheet s = ImportFixture.parse(rows);

        assertThat(s.headerRow()).isEqualTo(1);
        assertThat(s.columns()).containsOnlyKeys(Column.EMPLOYEE, Column.CODE, Column.DESIGNATION, Column.BUILDING);
        assertThat(s.dayColumns()).hasSize(31);
        assertThat(s.rows().get(0).cells()).containsExactly(Map.entry(JAN_1, "A"));
        assertThat(s.rows().get(0).department()).isNull();
    }

    @Test
    void theHeaderIsFoundOnlyInTheFirstTenRows() {
        List<List<Object>> rows = new ArrayList<>();
        for (int i = 0; i < 10; i++) rows.add(List.of("Notes line " + i));
        rows.add(januaryHeader());
        assertThatThrownBy(() -> ImportFixture.parse(rows)).isInstanceOf(HrmsException.class)
                .hasMessageContaining("No header row").extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
    }

    @Test
    void dateHeadersForARangeExcelDatesAndText() {
        LocalDate start = LocalDate.of(2026, 10, 15), end = LocalDate.of(2026, 11, 14);
        List<Object> header = new ArrayList<>(List.of("Employee"));
        header.add(LocalDate.of(2026, 10, 15));   // a real Excel date
        header.add("16 Oct");
        header.add("17-Oct");
        header.add("2026-10-18");
        header.add("1 Nov");
        List<List<Object>> rows = List.of(header, List.of("Ravi Kumar", "A", "B", "C", "WO", "G"));

        ParsedSheet s = RosterSheetParser.parse("r.xlsx", xlsx(rows), start, end);

        assertThat(s.dayByDate()).containsOnlyKeys(start, start.plusDays(1), start.plusDays(2), start.plusDays(3), LocalDate.of(2026, 11, 1));
        assertThat(s.rows().get(0).cells().get(LocalDate.of(2026, 11, 1))).isEqualTo("G");
        assertThat(s.notes()).extracting(Note::code).containsExactly("DAY_COLUMN_MISSING");
    }

    @Test
    void dayNumbersFollowTheRangeInOrderAcrossAMonthEnd() {
        LocalDate start = LocalDate.of(2026, 10, 15), end = LocalDate.of(2026, 11, 14);
        List<Object> header = new ArrayList<>(List.of("Employee"));
        for (int d = 15; d <= 31; d++) header.add(String.valueOf(d));
        for (int d = 1; d <= 14; d++) header.add(String.format("%02d", d));
        ParsedSheet s = RosterSheetParser.parse("r.xlsx", xlsx(List.of(header, List.of("Ravi Kumar"))), start, end);
        assertThat(s.dayByDate()).containsOnlyKeys(dates(start, end));
        assertThat(s.dayColumns().get(0).date()).isEqualTo(start);
        assertThat(s.dayColumns().get(17).date()).isEqualTo(LocalDate.of(2026, 11, 1));
        assertThat(s.notes()).isEmpty();
    }

    @Test
    void dayWithItsWeekdayInOneHeaderCell() {
        List<Object> header = new ArrayList<>(List.of("Employee", "1 Fri", "Sat 2", "03\nSun"));
        ParsedSheet s = ImportFixture.parse(List.of(header, List.of("Ravi Kumar", "A", "B", "WO")));
        assertThat(s.rows().get(0).cells()).containsOnlyKeys(JAN_1, JAN_1.plusDays(1), JAN_1.plusDays(2));
    }

    @Test
    void day31InAThirtyDayMonthMustBeEmpty() {
        List<Object> header = new ArrayList<>(List.of("Employee"));
        for (int d = 1; d <= 31; d++) header.add(String.format("%02d", d));
        List<Object> filled = new ArrayList<>(List.of("Ravi Kumar"));
        for (int d = 1; d <= 31; d++) filled.add("A");
        List<Object> empty31 = new ArrayList<>(List.of("Praveen Rao"));
        for (int d = 1; d <= 30; d++) empty31.add("B");

        ParsedSheet s = RosterSheetParser.parse("r.xlsx", xlsx(List.of(header, filled, empty31)), NOV_1, NOV_30);

        assertThat(s.dayByDate()).hasSize(30);
        DayColumnAssert.outside(s.dayColumns().get(30), "Day 31 isn't in the period (November 2026)");
        assertThat(s.rows().get(0).outside()).hasSize(1);
        assertThat(s.rows().get(0).outside().get(0).raw()).isEqualTo("A");
        assertThat(s.rows().get(1).outside()).isEmpty();
        assertThat(s.notes()).isEmpty();
    }

    @Test
    void twoColumnsForOneDateIsAnError() {
        List<Object> header = new ArrayList<>(List.of("Employee", "01", "02", "1 Jan"));
        ParsedSheet s = ImportFixture.parse(List.of(header, List.of("Ravi Kumar", "A", "B", "C")));
        assertThat(s.notes()).filteredOn(n -> n.code().equals("DAY_COLUMN_TWICE")).singleElement()
                .satisfies(n -> {
                    assertThat(n.severity()).isEqualTo(Level.error);
                    assertThat(n.column()).isEqualTo("D");
                    assertThat(n.message()).isEqualTo("Columns B and D are both for 1 Jan. Keep one of them.");
                });
        assertThat(s.rows().get(0).cells()).containsExactly(Map.entry(JAN_1, "A"), Map.entry(JAN_1.plusDays(1), "B"));
    }

    @Test
    void rowsThatAreNotPeople() {
        List<List<Object>> rows = new ArrayList<>(List.of(januaryHeader()));
        rows.add(new ArrayList<>(List.of("", "", "", "", "", "Fri", "Sat")));       // weekday names: skipped
        rows.add(januaryRow(RAVI, Map.of(1, "A")));
        rows.add(List.of());                                                       // blank: skipped
        rows.add(new ArrayList<>(List.of("", "", "", "", "", "A", "B")));          // codes and no one: error
        rows.add(new ArrayList<>(List.of("Total", "", "", "", "", "3", "4")));     // a totals row: skipped
        ParsedSheet s = ImportFixture.parse(rows);

        assertThat(s.rows()).extracting(RosterSheetParser.SheetRow::employee).containsExactly("Ravi Kumar");
        assertThat(s.notes()).extracting(Note::code, Note::rowNo, Note::severity)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("NO_EMPLOYEE", 5, Level.error),
                        org.assertj.core.groups.Tuple.tuple("SUMMARY_ROW", 6, Level.info));
    }

    @Test
    void totalsAreReadAsNumbers() {
        List<Object> row = januaryRow(RAVI, Map.of(1, "A", 2, "WO"));
        row.addAll(List.of(1, "1", "", "x", 0));
        ParsedSheet s = ImportFixture.parse(List.of(januaryHeader(), row));
        assertThat(s.rows().get(0).totals()).containsOnly(Map.entry(Total.WORKING, 1.0), Map.entry(Total.WO, 1.0), Map.entry(Total.COFF, 0.0));
    }

    @Test
    void csvWithAByteOrderMarkQuotesAndCrLf() {
        String text = "﻿Roster title\r\nEmployee,Employee code,01,02\r\n\"Kumar, Ravi\",TV-101,A,\"W/O\"\r\n";
        ParsedSheet s = RosterSheetParser.parse("roster.CSV", text.getBytes(StandardCharsets.UTF_8), JAN_1, JAN_31);
        assertThat(s.sheetName()).isEqualTo("CSV");
        assertThat(s.headerRow()).isEqualTo(2);
        assertThat(s.rows().get(0).employee()).isEqualTo("Kumar, Ravi");
        assertThat(s.rows().get(0).cells()).containsExactly(Map.entry(JAN_1, "A"), Map.entry(JAN_1.plusDays(1), "W/O"));
    }

    @Test
    void theSyntheticS13SampleFileReadsCleanly() throws IOException {
        byte[] bytes;
        try (InputStream in = getClass().getResourceAsStream("/roster-import/s13-january-2027-sample.csv")) {
            assertThat(in).isNotNull();
            bytes = in.readAllBytes();
        }
        ParsedSheet s = RosterSheetParser.parse("s13-january-2027-sample.csv", bytes, JAN_1, JAN_31);
        assertThat(s.headerRow()).isEqualTo(2);
        assertThat(s.dayByDate()).hasSize(31);
        assertThat(s.rows()).hasSize(6);
        assertThat(s.notes()).isEmpty();
        assertThat(s.rows().get(0).cells().get(LocalDate.of(2027, 1, 26))).isEqualTo("PH");
        assertThat(s.rows().get(0).totals()).containsEntry(Total.WORKING, 25.0);
    }

    @Test
    void aWorkbookPrefersTheRosterSheetAndSkipsTheCodesSheet() {
        try (var wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(); var out = new java.io.ByteArrayOutputStream()) {
            var codes = wb.createSheet("Codes");
            codes.createRow(0).createCell(0).setCellValue("Employee");   // would look like a header
            var other = wb.createSheet("Notes");
            other.createRow(0).createCell(0).setCellValue("nothing here");
            var roster = wb.createSheet("January");
            var h = roster.createRow(0);
            h.createCell(0).setCellValue("Employee");
            h.createCell(1).setCellValue("01");
            var r = roster.createRow(1);
            r.createCell(0).setCellValue("Ravi Kumar");
            r.createCell(1).setCellValue("A");
            wb.write(out);
            ParsedSheet s = RosterSheetParser.parse("r.xlsx", out.toByteArray(), JAN_1, JAN_31);
            assertThat(s.sheetName()).isEqualTo("January");
            assertThat(s.rows()).hasSize(1);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    // ── limits and unreadable files ──────────────────────────────────────────

    @Test
    void refusesAFileOverTwoMegabytes() {
        byte[] big = new byte[(int) RosterSheetLayout.MAX_FILE_BYTES + 1];
        assertThatThrownBy(() -> RosterSheetParser.parse("r.csv", big, JAN_1, JAN_31))
                .hasMessageContaining("larger than 2 MB").extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
    }

    @Test
    void refusesMoreThanTwoThousandPeople() {
        StringBuilder b = new StringBuilder("Employee,01\r\n");
        for (int i = 0; i <= RosterSheetLayout.MAX_ROWS; i++) b.append("Person ").append(i).append(",A\r\n");
        byte[] bytes = b.toString().getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> RosterSheetParser.parse("r.csv", bytes, JAN_1, JAN_31))
                .hasMessageContaining("more than 2,000 rows").extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");

        StringBuilder ok = new StringBuilder("Employee,01\r\n");
        for (int i = 0; i < RosterSheetLayout.MAX_ROWS; i++) ok.append("Person ").append(i).append(",A\r\n");
        assertThat(RosterSheetParser.parse("r.csv", ok.toString().getBytes(StandardCharsets.UTF_8), JAN_1, JAN_31).rows())
                .hasSize(RosterSheetLayout.MAX_ROWS);
    }

    @Test
    void refusesOtherFileTypesAndJunk() {
        byte[] text = "Employee,01\r\nRavi,A\r\n".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> RosterSheetParser.parse("r.xls", text, JAN_1, JAN_31)).hasMessageContaining(".xls")
                .extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
        assertThatThrownBy(() -> RosterSheetParser.parse("r.pdf", text, JAN_1, JAN_31)).hasMessageContaining("Upload an Excel file")
                .extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
        assertThatThrownBy(() -> RosterSheetParser.parse("r.xlsx", text, JAN_1, JAN_31)).hasMessageContaining("can't be read as an Excel")
                .extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
        assertThatThrownBy(() -> RosterSheetParser.parse("r.csv", new byte[0], JAN_1, JAN_31)).hasMessageContaining("empty");
    }

    @Test
    void refusesAHeaderWithNoDayColumns() {
        byte[] bytes = "Employee,Department\r\nRavi,Technical\r\n".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> RosterSheetParser.parse("r.csv", bytes, JAN_1, JAN_31)).hasMessageContaining("No day columns")
                .extracting("errorCode").isEqualTo("IMPORT_FILE_INVALID");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static List<LocalDate> dates(LocalDate from, LocalDate to) {
        List<LocalDate> out = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) out.add(d);
        return out;
    }

    private static final class DayColumnAssert {
        static void outside(RosterSheetParser.DayColumn c, String reason) {
            assertThat(c.date()).isNull();
            assertThat(c.outside()).isEqualTo(reason);
        }
    }
}
