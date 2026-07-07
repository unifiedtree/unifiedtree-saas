package com.unifiedtree.settings.service;

import com.unifiedtree.settings.dto.SettingsDtos.HrConfigResponse;
import com.unifiedtree.settings.dto.SettingsDtos.NextEmployeeCodeResponse;
import com.unifiedtree.settings.dto.SettingsDtos.UpdateHrConfigRequest;
import com.unifiedtree.settings.entity.HrConfiguration;
import com.unifiedtree.settings.repository.HrConfigurationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.UUID;

@Service
@Transactional
public class HrConfigurationService {

    private final HrConfigurationRepository repository;

    public HrConfigurationService(HrConfigurationRepository repository) {
        this.repository = repository;
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

    /** Non-consuming preview of what the next employee code will look like. */
    @Transactional(readOnly = true)
    public NextEmployeeCodeResponse previewNextEmployeeCode(UUID companyId) {
        HrConfiguration cfg = repository.findByCompanyId(companyId).orElseGet(() -> {
            HrConfiguration draft = new HrConfiguration();
            draft.setCompanyId(companyId);
            return draft;
        });
        return new NextEmployeeCodeResponse(
                formatCode(cfg.getEmployeeCodePrefix(), cfg.getEmployeeCodeNextNumber(), cfg.getEmployeeCodePadding()),
                cfg.getEmployeeCodePrefix(),
                cfg.getEmployeeCodeNextNumber(),
                cfg.getEmployeeCodePadding());
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
