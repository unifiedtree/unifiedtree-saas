package com.hrms.api.workforce;

import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Renders the Workforce Directory as a CSV download.
 *
 * <p>Columns are the directory's own, human-readable ones — names instead of
 * ids for department / designation / branch / manager. Deliberately absent:
 * salary, CTC, bank, PAN, Aadhaar, UAN/ESI, date of birth. The directory list
 * projection already blanks or masks those for exactly this reason (bulk
 * scraping), and an export must never be a wider door than the screen.
 *
 * <p>Cells are RFC-4180 escaped and guarded against spreadsheet formula
 * injection: a value starting with = + - @ tab or CR is prefixed with an
 * apostrophe so Excel/Sheets show it as text instead of evaluating it (an
 * employee named "=HYPERLINK(...)" must not become a link in HR's workbook).
 * A UTF-8 BOM keeps Excel on Windows from mangling non-ASCII names.
 */
final class EmployeeDirectoryCsv {

    static final List<String> HEADER = List.of(
            "Employee code", "First name", "Last name", "Work email", "Phone",
            "Department", "Designation", "Branch", "Reporting manager",
            "Employment type", "Status", "Date of joining", "Probation end", "Notice start", "Last working day");

    private EmployeeDirectoryCsv() {}

    static byte[] render(List<WorkforceEmployeeResponse> rows,
                         Map<UUID, String> departments,
                         Map<UUID, String> designations,
                         Map<UUID, String> branches,
                         Map<UUID, String> managers) {
        StringBuilder out = new StringBuilder();
        out.append(line(HEADER.stream().map(h -> (Object) h).toList()));
        for (WorkforceEmployeeResponse e : rows) {
            out.append(line(List.of(
                    nz(e.employeeCode()), nz(e.firstName()), nz(e.lastName()), nz(e.email()), nz(e.phone()),
                    name(departments, e.departmentId()), name(designations, e.designationId()),
                    name(branches, e.branchId()), name(managers, e.reportingManagerId()),
                    e.employmentType() == null ? "" : e.employmentType().name(),
                    e.employmentStatus() == null ? "" : e.employmentStatus().name(),
                    nz(e.dateOfJoining()), nz(e.probationEndDate()), nz(e.noticeStartDate()), nz(e.lastWorkingDay()))));
        }
        return ("﻿" + out).getBytes(StandardCharsets.UTF_8);
    }

    private static String line(List<Object> cells) {
        return String.join(",", cells.stream().map(EmployeeDirectoryCsv::escape).toList()) + "\r\n";
    }

    private static Object nz(Object value) {
        return value == null ? "" : value;
    }

    private static String name(Map<UUID, String> names, UUID id) {
        if (id == null) return "";
        String n = names.get(id);
        return n == null ? "" : n;
    }

    static String escape(Object value) {
        if (value == null) return "";
        String text = String.valueOf(value);
        if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) {
            text = "'" + text;
        }
        boolean mustQuote = text.indexOf(',') >= 0 || text.indexOf('"') >= 0
                || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0;
        return mustQuote ? "\"" + text.replace("\"", "\"\"") + "\"" : text;
    }
}
