package com.unifiedtree.settings.service;

import com.unifiedtree.settings.dto.SettingsDtos.HrConfigResponse;
import com.unifiedtree.settings.dto.SettingsDtos.UpdateHrConfigRequest;
import com.unifiedtree.settings.entity.HrConfiguration;
import com.unifiedtree.settings.repository.HrConfigurationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
        return toResponse(repository.save(cfg));
    }

    private HrConfigResponse toResponse(HrConfiguration c) {
        return new HrConfigResponse(
                c.getId(), c.getCompanyId(),
                c.getFiscalYearStart(), c.getDefaultNoticePeriodDays(),
                c.getProbationPeriodMonths(), c.getRetirementAge(),
                c.isEnableLateAutoDeduction(), c.getLateGraceMinutes(),
                c.isEnforceGeofencingForMobile(), c.isAllowWorkFromHome(),
                c.getWorkweekStartDay(), c.getWeekendDays());
    }
}
