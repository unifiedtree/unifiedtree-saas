package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The maths and rules of a bulk CTC revision, with no database: what each
 * person's new CTC and monthly split become, who is skipped and why, and what
 * stops a revision from being applied. {@link SalaryBulkRevisionService} loads
 * the data and writes the result; everything decided lives here so it can be
 * unit-tested.
 *
 * <p>The split rule is the salary drawer's rule for an existing structure:
 * every line that makes up gross (EARNING and REIMBURSEMENT) scales by the
 * same ratio as the CTC, rounded to whole rupees, and the rounding difference
 * goes to the largest line so the lines add up exactly to the new gross. Any
 * other configured line (a fixed deduction, an employer contribution) is kept
 * as it is. A structure with no earning lines (payroll pays it as BASIC =
 * monthly CTC) stays that way, with the CTC revised.
 */
public final class SalaryRevisionPlanner {

    private SalaryRevisionPlanner() {}

    public enum Mode { PERCENT, AMOUNT }

    static final BigDecimal MAX_PERCENT = new BigDecimal("100");
    static final BigDecimal MAX_AMOUNT = new BigDecimal("10000000");
    static final int MAX_PEOPLE = 5000;
    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal TWELVE = new BigDecimal("12");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final String[] MON = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

    /** A configured structure line. */
    public record Line(UUID componentId, String code, String name, String category, BigDecimal monthlyAmount) {}

    /** One matched employee and their current structure (structureId null when they have none). */
    public record Candidate(UUID employeeId, String employeeCode, String name, UUID companyId, String companyName,
                            UUID departmentId, String department, UUID designationId, String designation, String grade,
                            UUID structureId, BigDecimal ctcAnnual, BigDecimal ctcMonthly,
                            LocalDate currentEffectiveFrom, List<Line> lines) {}

    /** A person the revision will change. {@code newLines} is the complete line set of the new structure. */
    public record PlannedRow(Candidate candidate, BigDecimal oldCtc, BigDecimal newCtc, BigDecimal difference,
                             BigDecimal oldGross, BigDecimal newGross, BigDecimal newCtcMonthly,
                             List<Line> newLines, boolean derivedFromCtc) {}

    /** A matched person the revision leaves alone, with the reason in plain English. */
    public record Skipped(UUID employeeId, String employeeCode, String name, String reason, String detail) {}

    public record Plan(List<PlannedRow> rows, List<Skipped> skipped,
                       BigDecimal totalOldCtc, BigDecimal totalNewCtc, String previewKey) {
        public BigDecimal totalDifference() { return totalNewCtc.subtract(totalOldCtc); }
    }

    /** A payroll run of one of the affected companies. */
    public record RunInfo(UUID companyId, String companyName, int year, int month,
                          LocalDate periodStart, LocalDate periodEnd, String status) {}

    public static final String SKIP_NO_STRUCTURE = "NO_STRUCTURE";
    public static final String SKIP_LATER_REVISION = "LATER_REVISION";
    public static final String SKIP_NO_PAY = "NO_PAY";

    // ── validation ──────────────────────────────────────────────────────────

    /** The request's mode, or a plain-English error. */
    public static Mode mode(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new BusinessRuleException("Choose how to revise: by a percentage or by a fixed amount.", "REVISION_MODE_REQUIRED");
        }
        try {
            return Mode.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new BusinessRuleException("Revise by PERCENT or AMOUNT.", "REVISION_MODE_INVALID");
        }
    }

    /**
     * Checks everything about the revision itself (not the people) and returns
     * the effective date. {@code today} is the India business date. A preview
     * doesn't need the reason yet; applying does.
     */
    public static LocalDate validate(Mode mode, BigDecimal value, String effectiveFrom, String reason,
                                     int explicitPeople, LocalDate today, boolean requireReason) {
        if (value == null || value.signum() <= 0) {
            throw new BusinessRuleException("Enter how much to increase pay by.", "REVISION_VALUE_REQUIRED");
        }
        if (mode == Mode.PERCENT && value.compareTo(MAX_PERCENT) > 0) {
            throw new BusinessRuleException("A percentage increase can be at most 100%.", "REVISION_VALUE_TOO_HIGH");
        }
        if (mode == Mode.AMOUNT && value.compareTo(MAX_AMOUNT) > 0) {
            throw new BusinessRuleException("A fixed increase can be at most ₹1,00,00,000 a year.", "REVISION_VALUE_TOO_HIGH");
        }
        if (effectiveFrom == null || effectiveFrom.isBlank()) {
            throw new BusinessRuleException("Choose the date the new pay starts.", "REVISION_DATE_REQUIRED");
        }
        LocalDate eff;
        try {
            eff = LocalDate.parse(effectiveFrom.trim());
        } catch (DateTimeParseException ex) {
            throw new BusinessRuleException("The effective date must be a date (yyyy-MM-dd).", "REVISION_DATE_INVALID");
        }
        if (eff.getDayOfMonth() != 1) {
            throw new BusinessRuleException("A revision starts on the 1st of a month, because payroll pays a whole month from one salary structure.",
                    "REVISION_DATE_NOT_MONTH_START");
        }
        LocalDate monthStart = today.withDayOfMonth(1);
        if (eff.isBefore(monthStart)) {
            throw new BusinessRuleException("The new pay can't start before " + day(monthStart)
                    + ": payroll doesn't calculate arrears for past months.", "REVISION_DATE_IN_PAST");
        }
        if (eff.isAfter(today.plusYears(1))) {
            throw new BusinessRuleException("Choose a date within the next 12 months.", "REVISION_DATE_TOO_FAR");
        }
        String r = reason == null ? "" : reason.trim();
        if (requireReason && r.length() < 3) {
            throw new BusinessRuleException("Give a reason. It is saved on each new salary structure and in the audit log.", "REVISION_REASON_REQUIRED");
        }
        if (r.length() > 500) {
            throw new BusinessRuleException("Keep the reason under 500 characters.", "REVISION_REASON_TOO_LONG");
        }
        if (explicitPeople > MAX_PEOPLE) {
            throw new BusinessRuleException("Choose at most " + MAX_PEOPLE + " people in one revision.", "REVISION_TOO_MANY");
        }
        return eff;
    }

    // ── maths ───────────────────────────────────────────────────────────────

    /** The new annual CTC in whole rupees. */
    public static BigDecimal newCtc(BigDecimal oldCtc, Mode mode, BigDecimal value) {
        BigDecimal raw = mode == Mode.PERCENT
                ? oldCtc.multiply(HUNDRED.add(value)).divide(HUNDRED, 6, RoundingMode.HALF_UP)
                : oldCtc.add(value);
        return raw.setScale(0, RoundingMode.HALF_UP).setScale(2, RoundingMode.UNNECESSARY);
    }

    /** Lines that make up gross — the same set the payroll engine adds up. */
    public static boolean isGrossLine(String category) {
        return "EARNING".equals(category) || "REIMBURSEMENT".equals(category);
    }

    /**
     * Scales {@code lines} to add up to {@code newGross} (whole rupees). Each
     * line keeps its share; the rounding difference goes to the largest line.
     */
    public static List<Line> scale(List<Line> lines, BigDecimal newGross) {
        BigDecimal old = lines.stream().map(l -> nz(l.monthlyAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Line> out = new ArrayList<>(lines.size());
        if (old.signum() <= 0) return out;
        for (Line l : lines) {
            BigDecimal amt = nz(l.monthlyAmount()).multiply(newGross).divide(old, 0, RoundingMode.HALF_UP);
            out.add(new Line(l.componentId(), l.code(), l.name(), l.category(), amt.setScale(2, RoundingMode.UNNECESSARY)));
        }
        BigDecimal diff = newGross.setScale(2, RoundingMode.HALF_UP)
                .subtract(out.stream().map(Line::monthlyAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        if (diff.signum() != 0 && !out.isEmpty()) {
            int big = 0;
            for (int i = 1; i < out.size(); i++) {
                if (out.get(i).monthlyAmount().compareTo(out.get(big).monthlyAmount()) > 0) big = i;
            }
            Line b = out.get(big);
            out.set(big, new Line(b.componentId(), b.code(), b.name(), b.category(), b.monthlyAmount().add(diff)));
        }
        return out;
    }

    /** Works out every matched person's revision (or why they're skipped), with totals and a key for the apply step. */
    public static Plan plan(List<Candidate> candidates, Mode mode, BigDecimal value, LocalDate effectiveFrom) {
        List<PlannedRow> rows = new ArrayList<>();
        List<Skipped> skipped = new ArrayList<>();
        BigDecimal totalOld = BigDecimal.ZERO, totalNew = BigDecimal.ZERO;
        for (Candidate c : candidates) {
            if (c.structureId() == null || c.ctcAnnual() == null || c.ctcAnnual().signum() <= 0) {
                skipped.add(new Skipped(c.employeeId(), c.employeeCode(), c.name(), SKIP_NO_STRUCTURE,
                        "No salary structure yet. Add one on Salary Structure first."));
                continue;
            }
            if (c.currentEffectiveFrom() != null && !c.currentEffectiveFrom().isBefore(effectiveFrom)) {
                skipped.add(new Skipped(c.employeeId(), c.employeeCode(), c.name(), SKIP_LATER_REVISION,
                        "Already has a structure from " + day(c.currentEffectiveFrom()) + ". Edit it on its own instead."));
                continue;
            }
            List<Line> lines = c.lines() == null ? List.of() : c.lines();
            List<Line> gross = lines.stream().filter(l -> isGrossLine(l.category())).toList();
            List<Line> other = lines.stream().filter(l -> !isGrossLine(l.category())).toList();
            boolean derived = gross.isEmpty();
            BigDecimal oldGross = derived ? nz(c.ctcMonthly())
                    : gross.stream().map(l -> nz(l.monthlyAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (oldGross.signum() <= 0) {
                skipped.add(new Skipped(c.employeeId(), c.employeeCode(), c.name(), SKIP_NO_PAY,
                        "The current structure has no pay to scale. Edit it on its own instead."));
                continue;
            }
            BigDecimal oldCtc = c.ctcAnnual().setScale(2, RoundingMode.HALF_UP);
            BigDecimal ctc = newCtc(oldCtc, mode, value);
            BigDecimal ctcMonthly = ctc.divide(TWELVE, 2, RoundingMode.HALF_UP);
            BigDecimal newGross;
            List<Line> newLines = new ArrayList<>();
            if (derived) {
                newGross = ctcMonthly;
            } else {
                newGross = oldGross.multiply(ctc).divide(oldCtc, 0, RoundingMode.HALF_UP).setScale(2, RoundingMode.UNNECESSARY);
                newLines.addAll(scale(gross, newGross));
            }
            newLines.addAll(other);
            rows.add(new PlannedRow(c, oldCtc, ctc, ctc.subtract(oldCtc), oldGross.setScale(2, RoundingMode.HALF_UP),
                    newGross, ctcMonthly, List.copyOf(newLines), derived));
            totalOld = totalOld.add(oldCtc);
            totalNew = totalNew.add(ctc);
        }
        return new Plan(List.copyOf(rows), List.copyOf(skipped), totalOld, totalNew,
                previewKey(rows, mode, value, effectiveFrom));
    }

    /**
     * Identifies exactly what a preview showed: the people, their current
     * structures and their new CTCs. Apply recomputes it and refuses when it
     * differs, so nobody applies numbers they didn't see.
     */
    public static String previewKey(List<PlannedRow> rows, Mode mode, BigDecimal value, LocalDate effectiveFrom) {
        StringBuilder sb = new StringBuilder()
                .append(mode).append('|').append(value.stripTrailingZeros().toPlainString()).append('|').append(effectiveFrom);
        rows.stream().sorted(Comparator.comparing(r -> r.candidate().employeeId()))
                .forEach(r -> sb.append('|').append(r.candidate().employeeId()).append(':')
                        .append(r.candidate().structureId()).append(':').append(r.newCtc().toPlainString()));
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(h).substring(0, 24);
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /**
     * Reasons the revision can't be applied yet, given the affected companies'
     * payroll runs. Payroll pays each run from each person's LATEST structure,
     * so:
     * <ul>
     *   <li>a locked or paid run on or after the effective date can't be
     *       changed any more (arrears aren't calculated), and</li>
     *   <li>a run for an earlier month that is still open would pick up the
     *       new pay the next time it is processed — it must be locked first.</li>
     * </ul>
     */
    public static List<String> runBlockers(List<RunInfo> runs, LocalDate effectiveFrom) {
        List<String> out = new ArrayList<>();
        for (RunInfo r : runs.stream().sorted(Comparator.comparing(RunInfo::periodStart)).toList()) {
            String label = MON[r.month() - 1] + " " + r.year();
            String co = r.companyName() == null || r.companyName().isBlank() ? "" : " for " + r.companyName();
            boolean closed = "LOCKED".equals(r.status()) || "PAID".equals(r.status());
            boolean open = "DRAFT".equals(r.status()) || "PROCESSING".equals(r.status());
            if (closed && !r.periodEnd().isBefore(effectiveFrom)) {
                out.add("The " + label + " payroll" + co + " is already " + ("PAID".equals(r.status()) ? "paid" : "locked")
                        + ", so pay from " + day(effectiveFrom) + " can't reach it (arrears aren't calculated). Choose "
                        + day(r.periodEnd().plusDays(1)) + " or later.");
            } else if (open && r.periodEnd().isBefore(effectiveFrom)) {
                out.add("The " + label + " payroll run" + co + " is still open. Payroll uses each person's latest salary structure, "
                        + "so lock that run before applying pay that starts on " + day(effectiveFrom) + ".");
            }
        }
        return out;
    }

    /** What the months without a run mean for the revision: hard stops and warnings. */
    public record MonthChecks(List<String> blockers, List<String> warnings) {}

    /**
     * Months that have no locked run yet. Because payroll pays each run from
     * each person's LATEST structure, a revision saved now is also paid by any
     * run made later for a month before its effective date. So, per company:
     * <ul>
     *   <li>it has locked payroll before: every month between the last locked
     *       run and the effective date must be locked first, or the pay would
     *       go out early (a blocker);</li>
     *   <li>it has never locked a run: a date after this month is allowed, with
     *       a warning to run and lock the months before it first.</li>
     * </ul>
     * Companies with an open earlier run are already stopped by
     * {@link #runBlockers} and are not repeated here.
     */
    public static MonthChecks unlockedMonthChecks(List<RunInfo> runs, java.util.Map<UUID, String> companies,
                                                  LocalDate effectiveFrom, LocalDate today) {
        List<String> blockers = new ArrayList<>(), warnings = new ArrayList<>();
        LocalDate monthStart = today.withDayOfMonth(1);
        for (java.util.Map.Entry<UUID, String> co : companies.entrySet()) {
            List<RunInfo> own = runs.stream().filter(r -> co.getKey().equals(r.companyId())).toList();
            boolean openBefore = own.stream().anyMatch(r -> ("DRAFT".equals(r.status()) || "PROCESSING".equals(r.status()))
                    && r.periodEnd().isBefore(effectiveFrom));
            if (openBefore) continue;
            String name = co.getValue() == null || co.getValue().isBlank() ? "" : " for " + co.getValue();
            LocalDate lastLocked = own.stream().filter(r -> "LOCKED".equals(r.status()) || "PAID".equals(r.status()))
                    .map(RunInfo::periodEnd).max(Comparator.naturalOrder()).orElse(null);
            if (lastLocked != null) {
                LocalDate firstOpen = lastLocked.plusDays(1).withDayOfMonth(1);
                if (lastLocked.plusDays(1).isBefore(effectiveFrom)) {
                    String label = monthLabel(firstOpen);
                    blockers.add("The " + label + " payroll" + name + " isn't locked yet. Payroll pays each month from each person's "
                            + "latest salary structure, so " + label + " would already pay the new amounts. Lock the " + label
                            + " payroll first" + (firstOpen.isBefore(monthStart) ? "" : ", or choose " + day(firstOpen)) + ".");
                }
            } else if (effectiveFrom.isAfter(monthStart)) {
                warnings.add("No payroll" + name + " has been locked yet. Payroll pays each month from each person's latest salary "
                        + "structure, so a run for a month before " + day(effectiveFrom) + " made after you apply this would already pay "
                        + "the new amounts. Run and lock those months first, or choose " + day(monthStart) + ".");
            }
        }
        return new MonthChecks(blockers, warnings);
    }

    static String monthLabel(LocalDate d) { return MON[d.getMonthValue() - 1] + " " + d.getYear(); }

    /** "+5%" or "+₹30,000 a year". */
    public static String describe(Mode mode, BigDecimal value) {
        return mode == Mode.PERCENT
                ? "+" + value.stripTrailingZeros().toPlainString() + "%"
                : "+" + rupees(value) + " a year";
    }

    /** ₹ with Indian digit grouping, whole rupees. */
    public static String rupees(BigDecimal v) {
        String digits = nz(v).setScale(0, RoundingMode.HALF_UP).abs().toPlainString();
        String sign = nz(v).signum() < 0 ? "-" : "";
        if (digits.length() <= 3) return sign + "₹" + digits;
        String last3 = digits.substring(digits.length() - 3);
        String rest = digits.substring(0, digits.length() - 3);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < rest.length(); i++) {
            if (i > 0 && (rest.length() - i) % 2 == 0) sb.append(',');
            sb.append(rest.charAt(i));
        }
        return sign + "₹" + sb + "," + last3;
    }

    public static String day(LocalDate d) { return d == null ? "" : DAY.format(d); }

    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
}
