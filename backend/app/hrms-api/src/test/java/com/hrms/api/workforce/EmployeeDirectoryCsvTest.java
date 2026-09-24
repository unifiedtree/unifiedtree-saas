package com.hrms.api.workforce;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Directory export escaping: RFC-4180 quoting plus spreadsheet formula-injection guard. */
class EmployeeDirectoryCsvTest {

    @Test
    void plainValuesAreUntouched() {
        assertEquals("Priya", EmployeeDirectoryCsv.escape("Priya"));
        assertEquals("", EmployeeDirectoryCsv.escape(null));
    }

    @Test
    void commasQuotesAndNewlinesAreQuoted() {
        assertEquals("\"Raghavan, Priya\"", EmployeeDirectoryCsv.escape("Raghavan, Priya"));
        assertEquals("\"say \"\"hi\"\"\"", EmployeeDirectoryCsv.escape("say \"hi\""));
        assertEquals("\"a\nb\"", EmployeeDirectoryCsv.escape("a\nb"));
    }

    @Test
    void formulaPrefixesBecomeText() {
        assertEquals("\"'=HYPERLINK(\"\"x\"\")\"", EmployeeDirectoryCsv.escape("=HYPERLINK(\"x\")"));
        assertEquals("'+91 98", EmployeeDirectoryCsv.escape("+91 98"));
        assertEquals("'-5", EmployeeDirectoryCsv.escape("-5"));
        assertEquals("'@cmd", EmployeeDirectoryCsv.escape("@cmd"));
    }
}
