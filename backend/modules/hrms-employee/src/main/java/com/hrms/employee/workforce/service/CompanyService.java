package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateCompanyRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateCompanyRequest;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional
public class CompanyService {

    private final WorkforceCompanyRepository repository;
    private final LiveHeadcount headcount;

    public CompanyService(WorkforceCompanyRepository repository, LiveHeadcount headcount) {
        this.repository = repository;
        this.headcount = headcount;
    }

    @Transactional(readOnly = true)
    public List<CompanyResponse> list() {
        return list(false);
    }

    /** {@code includeArchived}: also return archived (inactive) companies, for the "Inactive" filter. */
    @Transactional(readOnly = true)
    public List<CompanyResponse> list(boolean includeArchived) {
        Map<UUID, Integer> counts = headcount.byColumn("company_id");
        return (includeArchived
                ? repository.findAllByOrderByNameAsc()
                : repository.findAllByActiveTrueOrderByNameAsc())
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
    }

    @Transactional(readOnly = true)
    public CompanyResponse get(UUID id) {
        return toResponse(repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found")));
    }

    public CompanyResponse create(CreateCompanyRequest req) {
        Company c = new Company();
        c.setName(req.name());
        c.setLegalName(req.legalName());
        c.setRegistrationNumber(req.registrationNumber());
        c.setPanNumber(req.panNumber());
        c.setGstin(req.gstin());
        c.setIndustry(req.industry());
        c.setCountry(req.country() != null ? req.country() : "India");
        c.setTimezone(req.timezone() != null ? req.timezone() : "Asia/Kolkata");
        c.setCurrency(req.currency() != null ? req.currency() : "INR");
        c.setFiscalYearStart(req.fiscalYearStart() != null && !req.fiscalYearStart().isBlank()
                ? fiscalMonth(req.fiscalYearStart()) : "APRIL");
        c.setTanNumber(tan(req.tanNumber()));
        c.setIncorporationDate(incorporation(req.incorporationDate()));
        c.setDescription(ContractorService.blankToNull(req.description()));
        c.setActive(true);
        try {
            return toResponse(repository.save(c));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw new BusinessRuleException("Company with this name already exists", "DUPLICATE_COMPANY");
        }
    }

    /**
     * Patch semantics: a field is written ONLY when the caller supplied it.
     *
     * <p>2026-09-08 audit fix — this used to call setRegistrationNumber /
     * setPanNumber / setGstin / setLegalName / setIndustry unconditionally,
     * while country/timezone/currency/fiscalYearStart were already null-guarded.
     * The Edit Company drawer only sends {name, legalName, industry, currency,
     * country}, so PAN, GSTIN and the registration number arrived as null and
     * were written as null on every single edit — silently destroying the
     * statutory identifiers payroll needs for PF / ESI / TDS filings, while
     * the UI reported "Company updated".
     *
     * <p>Consequence of the guard: a field can no longer be CLEARED through
     * this endpoint. That is the correct trade-off here — the form has no
     * inputs for those three fields, so any null is "not supplied", never
     * "deliberately blanked".
     */
    public CompanyResponse update(UUID id, UpdateCompanyRequest req) {
        Company c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found"));
        if (req.name()               != null) c.setName(req.name());
        if (req.legalName()          != null) c.setLegalName(req.legalName());
        if (req.registrationNumber() != null) c.setRegistrationNumber(req.registrationNumber());
        if (req.panNumber()          != null) c.setPanNumber(req.panNumber());
        if (req.gstin()              != null) c.setGstin(req.gstin());
        if (req.industry()           != null) c.setIndustry(req.industry());
        if (req.country()            != null) c.setCountry(req.country());
        if (req.timezone()           != null) c.setTimezone(req.timezone());
        if (req.currency()           != null) c.setCurrency(req.currency());
        if (req.fiscalYearStart()    != null) c.setFiscalYearStart(fiscalMonth(req.fiscalYearStart()));
        // V143.22: here a blank value DOES clear the field; the Master form sends all three.
        if (req.tanNumber()          != null) c.setTanNumber(tan(req.tanNumber()));
        if (req.incorporationDate()  != null) c.setIncorporationDate(incorporation(req.incorporationDate()));
        if (req.description()        != null) c.setDescription(ContractorService.blankToNull(req.description()));
        try {
            return toResponse(repository.save(c));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw new BusinessRuleException("Company with this name already exists", "DUPLICATE_COMPANY");
        }
    }

    /**
     * The company record is the one fiscal year (decision D2, V143.14): HR
     * Configuration writes the same column. Both store an upper-case month
     * name ("APRIL"), so everything that reads it agrees.
     */
    static String fiscalMonth(String value) {
        String m = value == null ? "" : value.trim().toUpperCase(java.util.Locale.ROOT);
        try {
            java.time.Month.valueOf(m);
            return m;
        } catch (IllegalArgumentException notAMonth) {
            throw new BusinessRuleException("Fiscal year start must be a month name, for example APRIL",
                    "INVALID_FISCAL_YEAR_START");
        }
    }

    /** The company after an archive or restore, and whether this call changed it (false: it already was). */
    public record StatusChange(CompanyResponse company, boolean changed) { }

    /**
     * Soft archive: the company leaves every list and picker; its people and
     * records keep pointing at it. Refused for the workspace's last active
     * company (the app always needs one) and while people still work there
     * (the live headcount this company's response reports), so nobody is left
     * under a company no screen shows. Archiving an archived company changes
     * nothing.
     */
    public StatusChange archive(UUID id) {
        // Lock the active companies first: a second archive at the same moment waits
        // here, then sees this one's result, so the workspace always keeps one.
        List<Company> active = repository.findAllByActiveTrue();
        Company c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found"));
        if (!c.isActive()) return new StatusChange(toResponse(c), false);
        if (active.stream().noneMatch(other -> !other.getId().equals(id))) {
            throw new BusinessRuleException(
                    "This is the only active company. Add or restore another company before archiving this one.",
                    "LAST_ACTIVE_COMPANY");
        }
        int people = headcount.countFor("company_id", id);
        if (people > 0) {
            throw new BusinessRuleException(
                    (people == 1 ? "1 person still works at " : people + " people still work at ") + c.getName()
                            + ". Move them to another company or record their exit first.",
                    "COMPANY_HAS_EMPLOYEES");
        }
        c.setActive(false);
        return new StatusChange(toResponse(repository.save(c), 0), true);
    }

    /**
     * Bring an archived company back: it shows in lists and pickers again.
     * Restoring an active company changes nothing (as restoring a branch).
     */
    public StatusChange restore(UUID id) {
        Company c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found"));
        if (c.isActive()) return new StatusChange(toResponse(c), false);
        c.setActive(true);
        return new StatusChange(toResponse(repository.save(c)), true);
    }

    /** Upper-cased TAN (AAAA99999A, checked on the request); blank = none. */
    static String tan(String s) {
        String t = ContractorService.blankToNull(s);
        return t == null ? null : t.toUpperCase();
    }

    /** yyyy-MM-dd; blank = none; a date in the future is refused. */
    static java.time.LocalDate incorporation(String s) {
        java.time.LocalDate d = ContractorService.parseDate(s, "date of incorporation");
        if (d != null && d.isAfter(java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")))) {
            throw new BusinessRuleException("The date of incorporation can't be in the future", "INVALID_DATE");
        }
        return d;
    }

    private CompanyResponse toResponse(Company c) {
        return toResponse(c, headcount.countFor("company_id", c.getId()));
    }

    /** {@code employees}: people working there now (see LiveHeadcount), not the never-updated cached column. */
    private CompanyResponse toResponse(Company c, int employees) {
        return new CompanyResponse(
                c.getId(), c.getName(), c.getLegalName(), c.getRegistrationNumber(),
                c.getPanNumber(), c.getGstin(), c.getIndustry(),
                c.getCountry(), c.getTimezone(), c.getCurrency(), c.getFiscalYearStart(),
                c.getLogoUrl(), employees, c.isActive(),
                c.getTanNumber(), c.getIncorporationDate(), c.getDescription());
    }
}
