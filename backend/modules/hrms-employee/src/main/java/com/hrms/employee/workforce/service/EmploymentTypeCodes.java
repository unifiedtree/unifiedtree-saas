package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Employment types (owner decision 6 Oct 2026): every company has the same five defaults, and may add
 * its own. An employee record stores the type's code (hrms.employees.employment_type, VARCHAR(30)).
 *
 * <p>The five defaults are the codes the product's own rules read: CONTRACT means the person comes
 * through a staffing agency (ContractorService links only CONTRACT workers). Payroll, attendance and
 * leave do not branch on the type, so a company's own type behaves like FULL_TIME everywhere; there is
 * no "kind" column to map it to another default's behaviour.
 *
 * <p>Defaults are seeded for every existing company by V143_103 and, for a company made later (sign-up,
 * Master → Add company, any other path), the first time its types are listed
 * ({@link EmploymentTypeService#listForCompany}) — the way the default shifts are.
 */
public final class EmploymentTypeCodes {

    private EmploymentTypeCodes() {}

    /** One of the five defaults: its code and the name a company starts with. */
    public record Default(String code, String name) {}

    public static final String FULL_TIME = "FULL_TIME";
    public static final String CONTRACT = "CONTRACT";

    public static final List<Default> DEFAULTS = List.of(
            new Default(FULL_TIME, "Full-time"),
            new Default("PART_TIME", "Part-time"),
            new Default(CONTRACT, "Contract"),
            new Default("INTERN", "Intern"),
            new Default("CONSULTANT", "Consultant"));

    /** The check constraint V014 put on hrms.employees (five codes only); V143_104 drops it. */
    static final String OLD_CHECK = "ck_employees_employment_type";

    /** "  full_time " → "FULL_TIME"; blank → null. */
    public static String normalize(String raw) {
        if (raw == null) return null;
        String s = raw.trim().toUpperCase(Locale.ROOT);
        return s.isEmpty() ? null : s;
    }

    /** True for the five default codes (case and spaces ignored). */
    public static boolean isDefault(String code) {
        String c = normalize(code);
        return c != null && DEFAULTS.stream().anyMatch(d -> d.code().equals(c));
    }

    /** A name as compared for duplicates: "Full Time", "full-time" and "FullTime" are the same name. */
    public static String nameKey(String name) {
        return name == null ? "" : name.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    /** The default whose standard name this is ("Full Time" → FULL_TIME), or null. */
    public static Default defaultNamed(String name) {
        String k = nameKey(name);
        return k.isEmpty() ? null : DEFAULTS.stream().filter(d -> nameKey(d.name()).equals(k)).findFirst().orElse(null);
    }

    static final String MISSING_SQL = """
            SELECT count(DISTINCT upper(trim(code))) FROM org.employment_types
             WHERE company_id = ? AND upper(trim(code)) IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT')
            """;

    /** The same statement as V143_103, for one company. Inserts only the missing defaults; never changes a row. */
    static final String SEED_SQL = """
            INSERT INTO org.employment_types
                (id, tenant_id, company_id, name, code, is_payroll_eligible, is_system, is_active,
                 created_at, updated_at, version)
            SELECT gen_random_uuid(), c.tenant_id, c.id, d.name, d.code, TRUE, TRUE, TRUE, now(), now(), 0
              FROM org.companies c
             CROSS JOIN (VALUES ('FULL_TIME','Full-time'), ('PART_TIME','Part-time'), ('CONTRACT','Contract'),
                                ('INTERN','Intern'), ('CONSULTANT','Consultant')) AS d(code, name)
             WHERE c.id = ?
               AND NOT EXISTS (SELECT 1 FROM org.employment_types t
                                WHERE t.company_id = c.id AND upper(trim(t.code)) = d.code)
            ON CONFLICT DO NOTHING
            """;

    /**
     * Adds the defaults the company doesn't have yet (by code). Returns how many were added. Idempotent:
     * a default that exists — renamed, inactive or not marked as a system row — is left exactly as it is.
     */
    public static int seedDefaults(JdbcTemplate jdbc, UUID companyId) {
        if (companyId == null) return 0;
        Integer have = jdbc.queryForObject(MISSING_SQL, Integer.class, companyId);
        if (have != null && have >= DEFAULTS.size()) return 0;
        return jdbc.update(SEED_SQL, companyId);
    }

    static final String ACTIVE_CODE_SQL = """
            SELECT code FROM org.employment_types
             WHERE company_id = ? AND upper(trim(code)) = ? AND is_active
             ORDER BY created_at LIMIT 1
            """;

    /**
     * The code to store on an employee of {@code companyId}. A default code is always accepted (as it was
     * before company types existed); any other code must be one of the company's ACTIVE employment types
     * (stored as that type's code). {@code current} is the person's code today: keeping it is always
     * allowed, so editing someone whose type was later switched off doesn't fail. Null/blank → null.
     */
    public static String resolveForEmployee(JdbcTemplate jdbc, UUID companyId, String raw, String current) {
        String code = normalize(raw);
        if (code == null) return null;
        if (isDefault(code)) return code;
        if (current != null && code.equals(normalize(current))) return current;
        List<String> found = companyId == null ? List.of()
                : jdbc.queryForList(ACTIVE_CODE_SQL, String.class, companyId, code);
        if (found.isEmpty()) {
            throw new BusinessRuleException("“" + raw.trim() + "” isn’t one of this company’s active employment types",
                    "EMPLOYMENT_TYPE_UNKNOWN");
        }
        return found.get(0);
    }

    /** True when the database still has V014's five-codes-only check (V143_104 not applied yet). */
    public static boolean isOldCheckViolation(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(OLD_CHECK)) return true;
        }
        return false;
    }

    /** What the person sees when {@link #isOldCheckViolation} — the page keeps the rest of their edit. */
    public static BusinessRuleException notReady() {
        return new BusinessRuleException("Your company’s own employment types can be given to people after an update "
                + "that isn’t installed yet. Pick one of the five default types for now.", "EMPLOYMENT_TYPE_NOT_READY");
    }
}
