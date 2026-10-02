package com.hrms.app.reports;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Report rows as a CSV file: the report pages' "Raw rows (CSV)" download and
 * the CSV a scheduled report email carries next to its PDF (BW-89), so both
 * are byte-for-byte the same format.
 *
 * <p>Column order comes from the first row's key order — Spring's
 * {@code JdbcTemplate.queryForList} returns insertion-ordered maps, so the
 * columns match the SELECT list rather than coming out alphabetised.
 *
 * <p>An empty result is a header-less but VALID empty CSV — "no leavers this
 * month" is a legitimate answer to a report.
 *
 * <p>A UTF-8 BOM is prepended so Excel on Windows opens rupee symbols and
 * non-ASCII names correctly instead of mojibake; every other reader
 * tolerates it.
 */
final class ReportCsv {

    private ReportCsv() {}

    static byte[] bytes(List<Map<String, Object>> rows) {
        StringBuilder out = new StringBuilder();
        if (!rows.isEmpty()) {
            List<String> columns = List.copyOf(rows.get(0).keySet());
            out.append(String.join(",", columns.stream().map(ReportCsv::escape).toList())).append("\r\n");
            for (Map<String, Object> row : rows) {
                List<String> cells = columns.stream().map(column -> escape(row.get(column))).toList();
                out.append(String.join(",", cells)).append("\r\n");
            }
        }
        return ("﻿" + out).getBytes(StandardCharsets.UTF_8);
    }

    /**
     * RFC-4180 escaping: a field is quoted when it contains a comma, a double
     * quote, CR or LF, and embedded quotes are doubled. Null becomes empty.
     */
    static String escape(Object value) {
        if (value == null) return "";
        String text = String.valueOf(value);
        boolean mustQuote = text.indexOf(',') >= 0 || text.indexOf('"') >= 0
                || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0;
        if (!mustQuote) return text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }
}
