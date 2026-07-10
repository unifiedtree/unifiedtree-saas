package com.unifiedtree.settings.service;

import com.unifiedtree.settings.dto.SettingsDtos.HrConfigResponse;
import com.unifiedtree.settings.dto.SettingsDtos.NextEmployeeCodeResponse;
import com.unifiedtree.settings.dto.SettingsDtos.UpdateHrConfigRequest;
import com.unifiedtree.settings.entity.HrConfiguration;
import com.unifiedtree.settings.repository.HrConfigurationRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.UUID;

@Service
@Transactional
public class HrConfigurationService {

    private final HrConfigurationRepository repository;
    private final JdbcTemplate jdbc;

    public HrConfigurationService(HrConfigurationRepository repository, JdbcTemplate jdbc) {
        this.repository = repository;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public HrConfigResponse getOrDefault(UUID companyId) {
        return repository.findByCompanyId(companyId)
                .map(this::toResponse)
                .orElseGet(() -> {
                    HrConfiguration draft = new HrConfiguration();
                    draft.setCompanyId(companyId);
                    return toResponse(draft);
                });
    }

    public HrConfigResponse update(UUID companyId, UpdateHrConfigRequest req) {
        HrConfiguration cfg = repository.findByCompanyId(companyId).orElseGet(() -> {
            HrConfiguration fresh = new HrConfiguration();
            fresh.setCompanyId(companyId);
            return fresh;
        });
        if (req.fiscalYearStart()           != null) cfg.setFiscalYearStart(req.fiscalYearStart());
        if (req.defaultNoticePeriodDays()   != null) cfg.setDefaultNoticePeriodDays(req.defaultNoticePeriodDays());
        if (req.probationPeriodMonths()     != null) cfg.setProbationPeriodMonths(req.probationPeriodMonths());
        if (req.retirementAge()             != null) cfg.setRetirementAge(req.retirementAge());
        if (req.enableLateAutoDeduction()   != null) cfg.setEnableLateAutoDeduction(req.enableLateAutoDeduction());
        if (req.lateGraceMinutes()          != null) cfg.setLateGraceMinutes(req.lateGraceMinutes());
        if (req.enforceGeofencingForMobile()!= null) cfg.setEnforceGeofencingForMobile(req.enforceGeofencingForMobile());
        if (req.allowWorkFromHome()         != null) cfg.setAllowWorkFromHome(req.allowWorkFromHome());
        if (req.workweekStartDay()          != null) cfg.setWorkweekStartDay(req.workweekStartDay());
        if (req.weekendDays()               != null) cfg.setWeekendDays(req.weekendDays());
        if (req.employeeCodePrefix()        != null) cfg.setEmployeeCodePrefix(req.employeeCodePrefix().toUpperCase(Locale.ROOT));
        if (req.employeeCodeNextNumber()    != null) cfg.setEmployeeCodeNextNumber(req.employeeCodeNextNumber());
        if (req.employeeCodePadding()       != null) cfg.setEmployeeCodePadding(req.employeeCodePadding());
        return toResponse(repository.save(cfg));
    }

    /**
     * Non-consuming preview of what the next employee code will look like.
     *
     * <p>Always computes the effective next number as MAX(counter,
     * actual_highest_in_use_for_this_prefix + 1). This means the field on
     * the Add Employee form always suggests a code that will NOT clash with
     * an existing row — even if employees were imported from Excel with
     * codes past the counter, or an admin manually saved SRC-500 as an
     * override.
     */
    public NextEmployeeCodeResponse previewNextEmployeeCode(UUID companyId) {
        HrConfiguration cfg = repository.findByCompanyId(companyId).orElseGet(() -> {
            HrConfiguration draft = new HrConfiguration();
            draft.setCompanyId(companyId);
            return draft;
        });
        String prefix  = cfg.getEmployeeCodePrefix();
        int padding    = cfg.getEmployeeCodePadding();
        long counter   = cfg.getEmployeeCodeNextNumber();
        Long dbHighest = jdbc.queryForObject("""
            SELECT COALESCE(MAX((regexp_replace(e.employee_code, '^' || ? || '-', ''))::bigint), 0)
              FROM hrms.employees e
             WHERE e.company_id = ?
               AND e.employee_code ~ ('^' || ? || '-[0-9]+$')
            """, Long.class, prefix, companyId, prefix);
        long effectiveNext = Math.max(counter, (dbHighest == null ? 0 : dbHighest) + 1);
        return new NextEmployeeCodeResponse(
                formatCode(prefix, effectiveNext, padding),
                prefix,
                effectiveNext,
                padding);
    }

    /**
     * Atomically issue the next employee code for this company: read the
     * current next_number, format the code, then increment the counter.
     * Runs in a REQUIRED transaction so the caller (employee-create) can roll
     * back the whole employee insert if anything downstream fails.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public String issueNextEmployeeCode(UUID companyId) {
        HrConfiguration cfg = repository.findByCompanyId(companyId).orElseGet(() -> {
            HrConfiguration fresh = new HrConfiguration();
            fresh.setCompanyId(companyId);
            return repository.save(fresh);
        });
        long issued = cfg.getEmployeeCodeNextNumber();
        String code = formatCode(cfg.getEmployeeCodePrefix(), issued, cfg.getEmployeeCodePadding());
        cfg.setEmployeeCodeNextNumber(issued + 1);
        repository.save(cfg);
        return code;
    }

    static String formatCode(String prefix, long number, int padding) {
        return prefix + "-" + String.format(Locale.ROOT, "%0" + padding + "d", number);
    }

    private HrConfigResponse toResponse(HrConfiguration c) {
        return new HrConfigResponse(
                c.getId(), c.getCompanyId(),
                c.getFiscalYearStart(), c.getDefaultNoticePeriodDays(),
                c.getProbationPeriodMonths(), c.getRetirementAge(),
                c.isEnableLateAutoDeduction(), c.getLateGraceMinutes(),
                c.isEnforceGeofencingForMobile(), c.isAllowWorkFromHome(),
                c.getWorkweekStartDay(), c.getWeekendDays(),
                c.getEmployeeCodePrefix(), c.getEmployeeCodeNextNumber(), c.getEmployeeCodePadding());
    }
}
