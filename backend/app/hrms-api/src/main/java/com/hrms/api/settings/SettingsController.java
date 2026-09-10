package com.hrms.api.settings;

import com.unifiedtree.settings.dto.SettingsDtos.CreateHolidayRequest;
import com.unifiedtree.settings.dto.SettingsDtos.HolidayResponse;
import com.unifiedtree.settings.dto.SettingsDtos.HrConfigResponse;
import com.unifiedtree.settings.dto.SettingsDtos.NextEmployeeCodeResponse;
import com.unifiedtree.settings.dto.SettingsDtos.UpdateHrConfigRequest;
import com.unifiedtree.settings.service.HolidayService;
import com.unifiedtree.settings.service.HrConfigurationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/settings")
public class SettingsController {

    private final HrConfigurationService hrConfig;
    private final HolidayService         holidays;

    public SettingsController(HrConfigurationService hrConfig, HolidayService holidays) {
        this.hrConfig = hrConfig;
        this.holidays = holidays;
    }

    // -- HR configuration ----------------------------------------------------
    @GetMapping("/hr-configuration")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN') or hasAuthority('settings.read')")
    public HrConfigResponse getHrConfig(@RequestParam UUID companyId) {
        return hrConfig.getOrDefault(companyId);
    }

    /**
     * Public-read subset: the weekend day array only.
     *
     * <p>2026-09-10: the Leave apply form needs to compute the number of
     * business days a request will consume, and the tenant may run a 6-day or
     * Fri+Sat workweek — so the SPA used to fetch /hr-configuration for the
     * weekend list. That endpoint is HR/admin/settings.read only, so every
     * plain employee (and every DEPT_MANAGER) 403'd on every render and the
     * client silently fell back to Sat+Sun. On a Fri+Sat workweek the "you
     * are requesting N days / exceeds your balance" preview shown to the
     * applicant was computed on the wrong weekend.
     *
     * <p>This endpoint returns ONLY the weekend day array — no seat counters,
     * no employee-code sequence, no other HR config. That is safe to expose
     * to any authenticated caller because it is the calendar rule the applicant
     * has to see anyway before they submit. Two-week weekend override lists
     * would need a separate call.
     */
    @GetMapping("/hr-configuration/weekend-days")
    @PreAuthorize("isAuthenticated()")
    public java.util.Map<String, Object> getWeekendDays(@RequestParam UUID companyId) {
        HrConfigResponse full = hrConfig.getOrDefault(companyId);
        return java.util.Map.of("weekendDays", full.weekendDays());
    }

    @PutMapping("/hr-configuration")
    @PreAuthorize("hasAuthority('settings.hrconfig.write')")
    public HrConfigResponse updateHrConfig(@RequestParam UUID companyId,
                                           @Valid @RequestBody UpdateHrConfigRequest req) {
        return hrConfig.update(companyId, req);
    }

    /**
     * Non-consuming preview of the NEXT employee code for a company. The
     * employee-create form calls this on mount to pre-fill the code field
     * (see EmployeeForm on web and the mobile employee-add flow).
     * Does NOT increment the counter — the real increment happens inside
     * WorkforceEmployeeService.create() so aborted forms never leave gaps.
     */
    @GetMapping("/employee-code/preview")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN') or hasAuthority('settings.read') or hasAuthority('employees.write')")
    public NextEmployeeCodeResponse previewNextEmployeeCode(@RequestParam UUID companyId) {
        return hrConfig.previewNextEmployeeCode(companyId);
    }

    // -- Holiday calendar ----------------------------------------------------
    @GetMapping("/holidays")
    @PreAuthorize("isAuthenticated()")
    public List<HolidayResponse> listHolidays(@RequestParam UUID companyId,
                                              @RequestParam(required = false) Integer year,
                                              @RequestParam(required = false) LocalDate from,
                                              @RequestParam(required = false) LocalDate to) {
        if (from != null && to != null) return holidays.between(companyId, from, to);
        return holidays.list(companyId, year);
    }

    @PostMapping("/holidays")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('settings.holidays.write')")
    public HolidayResponse createHoliday(@Valid @RequestBody CreateHolidayRequest req) {
        return holidays.create(req);
    }

    @DeleteMapping("/holidays/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('settings.holidays.write')")
    public void archiveHoliday(@PathVariable UUID id) {
        holidays.archive(id);
    }
}
