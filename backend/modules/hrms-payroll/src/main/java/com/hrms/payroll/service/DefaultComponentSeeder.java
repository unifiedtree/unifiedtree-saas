package com.hrms.payroll.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Seeds the 9 standard Indian payroll salary components for a tenant.
 * Idempotent (ON CONFLICT on (tenant_id, code)). Tenant context (SET LOCAL
 * app.tenant_id) must already be bound by the caller — this only runs the
 * INSERTs with the tenant_id supplied explicitly (RLS WITH CHECK passes).
 */
@Service
public class DefaultComponentSeeder {

    private final JdbcTemplate jdbc;

    public DefaultComponentSeeder(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** code, name, category, statutory, taxable, computation_type, percent, order */
    private static final Object[][] DEFAULTS = {
        {"BASIC",        "Basic Salary",              "EARNING",                false, true,  "FORMULA",          null,  10},
        {"HRA",          "House Rent Allowance",      "EARNING",                false, true,  "PERCENT_OF_BASIC", 40.0,  20},
        {"SPECIAL",      "Special Allowance",         "EARNING",                false, true,  "FORMULA",          null,  30},
        {"CONVEYANCE",   "Conveyance Allowance",      "EARNING",                false, false, "FIXED",            null,  40},
        {"PF_EMPLOYEE",  "Provident Fund (Employee)", "DEDUCTION",              true,  false, "STATUTORY",        null,  50},
        {"PF_EMPLOYER",  "Provident Fund (Employer)", "EMPLOYER_CONTRIBUTION",  true,  false, "STATUTORY",        null,  60},
        {"ESI_EMPLOYEE", "ESI (Employee)",            "DEDUCTION",              true,  false, "STATUTORY",        null,  70},
        {"ESI_EMPLOYER", "ESI (Employer)",            "EMPLOYER_CONTRIBUTION",  true,  false, "STATUTORY",        null,  80},
        {"PT",           "Professional Tax",          "DEDUCTION",              true,  false, "STATUTORY",        null,  90},
    };

    /** Returns the number of components after seeding (always 9 for a fresh tenant). */
    public int seedForTenant(UUID tenantId) {
        for (Object[] c : DEFAULTS) {
            jdbc.update("""
                INSERT INTO payroll.salary_components
                    (tenant_id, code, name, category, is_statutory, is_taxable,
                     computation_type, percent_value, display_order, is_system, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE)
                ON CONFLICT (tenant_id, code) DO NOTHING
                """,
                tenantId, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
        }
        Integer n = jdbc.queryForObject(
            "SELECT count(*) FROM payroll.salary_components WHERE tenant_id = ?", Integer.class, tenantId);
        return n == null ? 0 : n;
    }
}
