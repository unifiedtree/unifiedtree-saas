package com.hrms.letters.service;

import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.letters.dto.MergeFieldEntry;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class MergeFieldResolver {

    private static final Pattern FIELD_PATTERN = Pattern.compile("\\{\\{([^}]+)}}");
    private static final DateTimeFormatter SHORT_FMT  = DateTimeFormatter.ofPattern("dd MMM yyyy");
    private static final DateTimeFormatter LONG_FMT   = DateTimeFormatter.ofPattern("d MMMM yyyy");
    private static final DateTimeFormatter ISO_FMT    = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    public Map<String, String> buildContext(
            Employee employee,
            Company company,
            Department department,
            Designation designation,
            Branch branch,
            Employee manager,
            Map<String, String> overrides) {

        Map<String, String> ctx = new LinkedHashMap<>();

        // Employee
        put(ctx, "employee.firstName",        employee.getFirstName());
        put(ctx, "employee.lastName",         employee.getLastName());
        put(ctx, "employee.fullName",         employee.getFirstName() + " " + employee.getLastName());
        put(ctx, "employee.code",             employee.getEmployeeCode());
        put(ctx, "employee.workEmail",        employee.getEmail());
        put(ctx, "employee.personalEmail",    employee.getPersonalEmail());
        put(ctx, "employee.mobile",           employee.getPhone());
        put(ctx, "employee.designation",      designation != null ? designation.getTitle() : null);
        put(ctx, "employee.department",       department  != null ? department.getName()   : null);
        put(ctx, "employee.branch",           branch      != null ? branch.getName()       : null);
        put(ctx, "employee.joiningDate",      formatDate(employee.getDateOfJoining(), SHORT_FMT));
        put(ctx, "employee.joiningDate:long", formatDate(employee.getDateOfJoining(), LONG_FMT));
        put(ctx, "employee.confirmationDate", formatDate(employee.getDateOfConfirmation(), SHORT_FMT));
        put(ctx, "employee.lastWorkingDay",   formatDate(employee.getDateOfTermination(), SHORT_FMT));

        BigDecimal annualCtc = employee.getMonthlySalary() != null
                ? employee.getMonthlySalary().multiply(BigDecimal.valueOf(12))
                : null;
        put(ctx, "employee.ctc",        annualCtc != null ? formatInr(annualCtc) : null);
        put(ctx, "employee.ctc:words",  annualCtc != null ? inrToWords(annualCtc) : null);
        put(ctx, "employee.ctcWords",   annualCtc != null ? inrToWords(annualCtc) : null); // camelCase alias
        put(ctx, "employee.manager",    manager != null
                ? manager.getFirstName() + " " + manager.getLastName() : null);

        // Company
        if (company != null) {
            put(ctx, "company.name",                 company.getName());
            put(ctx, "company.legalName",            company.getLegalName());
            put(ctx, "company.cin",                  company.getRegistrationNumber());
            put(ctx, "company.pan",                  company.getPanNumber());
            put(ctx, "company.gstin",                company.getGstin());
            put(ctx, "company.address",              null); // branch address used instead
            put(ctx, "company.signatoryName",        null); // not in entity yet
            put(ctx, "company.signatoryDesignation", null);
        }

        // Date
        LocalDate today = LocalDate.now();
        put(ctx, "today",       formatDate(today, SHORT_FMT));
        put(ctx, "today:long",  formatDate(today, LONG_FMT));
        put(ctx, "today:iso",   formatDate(today, ISO_FMT));

        // Caller overrides win
        if (overrides != null) {
            ctx.putAll(overrides);
        }

        return ctx;
    }

    public String resolve(String template, Map<String, String> context) {
        Matcher m = FIELD_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String key    = m.group(1).trim();
            String value  = context.get(key);
            String replacement = value != null
                    ? Matcher.quoteReplacement(value)
                    : Matcher.quoteReplacement(unresolvedPlaceholder(key));
            m.appendReplacement(sb, replacement);
        }
        m.appendTail(sb);
        return sb.toString();
    }

    public List<MergeFieldEntry> catalogue() {
        return List.of(
                entry("employee.firstName",        "Employee First Name",        "Ravi",            "Employee"),
                entry("employee.lastName",         "Employee Last Name",         "Kumar",           "Employee"),
                entry("employee.fullName",         "Employee Full Name",         "Ravi Kumar",      "Employee"),
                entry("employee.code",             "Employee Code",              "EMP001",          "Employee"),
                entry("employee.workEmail",        "Work Email",                 "ravi@acme.com",   "Employee"),
                entry("employee.personalEmail",    "Personal Email",             "ravi@gmail.com",  "Employee"),
                entry("employee.mobile",           "Mobile Number",              "+91 9999999999",  "Employee"),
                entry("employee.designation",      "Designation",                "Software Engineer","Employee"),
                entry("employee.department",       "Department",                 "Engineering",     "Employee"),
                entry("employee.branch",           "Branch",                     "Mumbai HQ",       "Employee"),
                entry("employee.joiningDate",      "Joining Date (short)",       "01 Jan 2026",     "Employee"),
                entry("employee.joiningDate:long", "Joining Date (long)",        "1st January 2026","Employee"),
                entry("employee.confirmationDate", "Confirmation Date",          "01 Jul 2026",     "Employee"),
                entry("employee.lastWorkingDay",   "Last Working Day",           "31 Dec 2026",     "Employee"),
                entry("employee.ctc",              "CTC (₹ formatted)",          "₹ 12,00,000",     "Employee"),
                entry("employee.ctc:words",        "CTC in words",               "Twelve Lakh Rupees Only", "Employee"),
                entry("employee.manager",          "Reporting Manager Name",     "Amit Sharma",     "Employee"),
                entry("company.name",              "Company Name",               "Acme Pvt Ltd",    "Company"),
                entry("company.legalName",         "Legal Name",                 "Acme Private Limited","Company"),
                entry("company.cin",               "CIN / Registration No.",     "U12345MH2010PTC12345","Company"),
                entry("company.pan",               "Company PAN",                "AABCA1234C",      "Company"),
                entry("company.gstin",             "Company GSTIN",              "27AABCA1234C1Z5", "Company"),
                entry("company.signatoryName",     "Signatory Name",             "Priya Menon",     "Company"),
                entry("company.signatoryDesignation","Signatory Designation",    "HR Director",     "Company"),
                entry("today",                     "Today (short)",              "01 Jan 2026",     "Date"),
                entry("today:long",                "Today (long)",               "1st January 2026","Date"),
                entry("today:iso",                 "Today (ISO)",                "2026-01-01",      "Date")
        );
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void put(Map<String, String> ctx, String key, String value) {
        ctx.put(key, value); // null stays null — unresolved placeholder applied during resolve()
    }

    private static String formatDate(LocalDate date, DateTimeFormatter fmt) {
        return date != null ? date.format(fmt) : null;
    }

    private static String formatInr(BigDecimal amount) {
        // Indian lakh/crore grouping: last 3 digits, then groups of 2
        long val = amount.longValue();
        String raw = String.valueOf(val);
        if (raw.length() <= 3) return "₹ " + raw;
        String last3 = raw.substring(raw.length() - 3);
        String rest  = raw.substring(0, raw.length() - 3);
        StringBuilder grouped = new StringBuilder();
        int pos = rest.length() % 2;
        if (pos > 0) grouped.append(rest, 0, pos);
        for (int i = pos; i < rest.length(); i += 2) {
            if (!grouped.isEmpty()) grouped.append(',');
            grouped.append(rest, i, i + 2);
        }
        return "₹ " + grouped + "," + last3;
    }

    private static final String[] ONES = {
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
        "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    };
    private static final String[] TENS = {
        "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
    };

    private static String inrToWords(BigDecimal amount) {
        long val = amount.longValue();
        if (val == 0) return "Zero Rupees Only";
        StringBuilder sb = new StringBuilder();
        long crore = val / 10_000_000L;
        val %= 10_000_000L;
        long lakh  = val / 100_000L;
        val %= 100_000L;
        long thousand = val / 1_000L;
        val %= 1_000L;
        long hundred  = val / 100L;
        long rest     = val % 100L;
        if (crore    > 0) { sb.append(hundredsWords((int) crore)).append(" Crore "); }
        if (lakh     > 0) { sb.append(hundredsWords((int) lakh)).append(" Lakh "); }
        if (thousand > 0) { sb.append(hundredsWords((int) thousand)).append(" Thousand "); }
        if (hundred  > 0) { sb.append(ONES[(int) hundred]).append(" Hundred "); }
        if (rest     > 0) { sb.append(belowHundred((int) rest)); }
        return sb.toString().trim() + " Rupees Only";
    }

    private static String hundredsWords(int n) {
        int h = n / 100, r = n % 100;
        StringBuilder sb = new StringBuilder();
        if (h > 0) sb.append(ONES[h]).append(" Hundred ");
        if (r > 0) sb.append(belowHundred(r));
        return sb.toString().trim();
    }

    private static String belowHundred(int n) {
        if (n < 20) return ONES[n];
        return TENS[n / 10] + (n % 10 != 0 ? " " + ONES[n % 10] : "");
    }

    private static String unresolvedPlaceholder(String key) {
        return "<span style=\"color:red;background:#fff0f0;padding:0 2px;border-radius:2px\">[unresolved: " + key + "]</span>";
    }

    private static MergeFieldEntry entry(String key, String label, String example, String category) {
        return new MergeFieldEntry(key, label, example, category);
    }
}
