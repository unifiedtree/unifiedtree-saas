package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.entity.EmploymentType;
import com.hrms.employee.workforce.repository.EmploymentTypeRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Master → Employment types (Classification Rules). Owner decision 6 Oct 2026: five fixed defaults
 * (Full-time, Part-time, Contract, Intern, Consultant — {@link EmploymentTypeCodes#DEFAULTS}) that every
 * company has and nobody can remove, rename, re-code or switch off; a company adds, edits and switches
 * off its own. People can be given any active type of their company (WorkforceEmployeeService).
 */
@Service
public class EmploymentTypeService {

    private final EmploymentTypeRepository repo;
    private final JdbcTemplate jdbc;

    public EmploymentTypeService(EmploymentTypeRepository repo, JdbcTemplate jdbc) {
        this.repo = repo;
        this.jdbc = jdbc;
    }

    /**
     * The company's active types. A company that is missing a default gets it first (V143_103 did this
     * for every company that existed; this covers each company made after it, whatever made it).
     */
    @Transactional
    public List<EmploymentType> listForCompany(UUID companyId) {
        return listForCompany(companyId, false);
    }

    /** {@code includeInactive}: also the switched-off ones, for Master's list (so they can be switched on again). */
    @Transactional
    public List<EmploymentType> listForCompany(UUID companyId, boolean includeInactive) {
        EmploymentTypeCodes.seedDefaults(jdbc, companyId);
        if (!includeInactive) return repo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId);
        return repo.findByCompanyIdOrderByNameAsc(companyId).stream()
                .sorted(Comparator.comparing((EmploymentType t) -> !t.isActive()))
                .toList();
    }

    @Transactional
    /**
     * Revives a soft-deleted employment type with the same code instead of
     * rejecting it. archive() only sets active=false and the list filters
     * activeTrue, so the row is hidden from the user but still seen by the old
     * exists-check — "add, delete, add the same again" returned 422 (client
     * report 2026-08-30). Filtering the check by active would instead collide
     * with the non-partial unique index uq_emp_type_tenant_code and surface as
     * a 500.
     */
    public EmploymentType create(EmploymentType type) {
        String code = EmploymentTypeCodes.normalize(type.getCode());
        if (code == null) throw new BusinessRuleException("Enter a code", "EMPLOYMENT_TYPE_CODE_REQUIRED");
        String name = type.getName() == null ? "" : type.getName().trim();
        if (name.isEmpty()) throw new BusinessRuleException("Enter a name", "EMPLOYMENT_TYPE_NAME_REQUIRED");
        type.setCode(code);
        type.setName(name);
        // Only the defaults are system rows (seeded); a request can't make its own type one.
        type.setSystem(false);

        if (EmploymentTypeCodes.isDefault(code)) {
            // The defaults come from seeding only, with their own names; asking for one again switches
            // it back on if an older workspace had switched it off.
            EmploymentTypeCodes.seedDefaults(jdbc, type.getCompanyId());
            EmploymentType std = repo.findByCompanyIdAndCode(type.getCompanyId(), code).orElse(null);
            if (std == null) throw new ResourceNotFoundException("Company", type.getCompanyId());
            if (std.isActive()) throw new BusinessRuleException("Employment type code already exists: " + code);
            std.setActive(true);
            return repo.save(std);
        }

        EmploymentType existing = repo
                .findByCompanyIdAndCode(type.getCompanyId(), type.getCode())
                .orElse(null);

        if (existing != null && existing.isActive()) {
            throw new BusinessRuleException("Employment type code already exists: " + type.getCode());
        }
        assertNameFree(type.getCompanyId(), code, name, existing == null ? null : existing.getId());
        if (existing != null) {
            existing.setName(type.getName());
            existing.setPayrollEligible(type.isPayrollEligible());
            existing.setActive(true);
            existing.setTenantId(TenantContext.getTenantId());
            return repo.save(existing);
        }
        type.setTenantId(TenantContext.getTenantId());
        return repo.save(type);
    }

    @Transactional
    public EmploymentType update(UUID id, EmploymentType update) {
        EmploymentType existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        String code = EmploymentTypeCodes.normalize(update.getCode());
        String name = update.getName() == null ? "" : update.getName().trim();
        if (existing.isBuiltIn()) {
            // A default keeps its name and code and stays on (it may be switched back on, if an
            // older workspace switched it off). Payroll eligible is the only other field, as before.
            if (code != null && !code.equals(EmploymentTypeCodes.normalize(existing.getCode()))
                    || !name.isEmpty() && !name.equals(existing.getName())) {
                throw new BusinessRuleException("Default employment types can’t be renamed or re-coded",
                        "EMPLOYMENT_TYPE_DEFAULT");
            }
            if (!update.isActive() && existing.isActive()) {
                throw new BusinessRuleException("Default employment types can’t be switched off",
                        "EMPLOYMENT_TYPE_DEFAULT");
            }
            existing.setPayrollEligible(update.isPayrollEligible());
            existing.setActive(true);
            return repo.save(existing);
        }
        if (code == null) throw new BusinessRuleException("Enter a code", "EMPLOYMENT_TYPE_CODE_REQUIRED");
        if (name.isEmpty()) throw new BusinessRuleException("Enter a name", "EMPLOYMENT_TYPE_NAME_REQUIRED");
        if (EmploymentTypeCodes.isDefault(code)) {
            throw new BusinessRuleException(code + " is a default type's code", "EMPLOYMENT_TYPE_DEFAULT");
        }
        if (!code.equals(EmploymentTypeCodes.normalize(existing.getCode()))) {
            // People hold the code, so a code in use can't change under them.
            Integer holders = jdbc.queryForObject(
                    "SELECT count(*) FROM hrms.employees WHERE company_id = ? AND upper(trim(employment_type)) = ?",
                    Integer.class, existing.getCompanyId(), EmploymentTypeCodes.normalize(existing.getCode()));
            if (holders != null && holders > 0) {
                throw new BusinessRuleException("People have this type, so its code can’t change", "EMPLOYMENT_TYPE_IN_USE");
            }
            if (repo.findByCompanyIdAndCode(existing.getCompanyId(), code).filter(o -> !o.getId().equals(id)).isPresent()) {
                throw new BusinessRuleException("Employment type code already exists: " + code);
            }
        }
        if (!EmploymentTypeCodes.nameKey(name).equals(EmploymentTypeCodes.nameKey(existing.getName()))) {
            assertNameFree(existing.getCompanyId(), code, name, id);
        }
        existing.setName(name);
        // 2026-09-09: neither code nor payrollEligible was copied, so both the
        // Code field and the "Payroll eligible" checkbox were accepted and
        // silently discarded. payrollEligible is the flag that decides whether
        // an employment type gets paid at all, so an admin could untick it,
        // see "saved", and still have that population run through payroll.
        existing.setCode(code);
        existing.setPayrollEligible(update.isPayrollEligible());
        existing.setActive(update.isActive());
        return repo.save(existing);
    }

    /** Switches a company's own type off (people who have it keep it). The defaults can't be. */
    @Transactional
    public void archive(UUID id) {
        EmploymentType type = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        if (type.isBuiltIn()) {
            throw new BusinessRuleException("Default employment types can’t be removed", "EMPLOYMENT_TYPE_DEFAULT");
        }
        type.setActive(false);
        repo.save(type);
    }

    /**
     * Two active types of one company can't share a name ("Full Time" = "full-time"), and a company's own
     * type can't take a default's name: pages show the defaults by those names.
     */
    private void assertNameFree(UUID companyId, String code, String name, UUID self) {
        EmploymentTypeCodes.Default std = EmploymentTypeCodes.defaultNamed(name);
        if (std != null && !std.code().equals(code)) {
            throw new BusinessRuleException("“" + name + "” is a default type's name — pick another", "EMPLOYMENT_TYPE_NAME_TAKEN");
        }
        String key = EmploymentTypeCodes.nameKey(name);
        boolean taken = repo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId).stream()
                .anyMatch(t -> !t.getId().equals(self) && EmploymentTypeCodes.nameKey(t.getName()).equals(key));
        if (taken) {
            throw new BusinessRuleException("This company already has a type called “" + name + "”", "EMPLOYMENT_TYPE_NAME_TAKEN");
        }
    }
}
