package com.hrms.api.settings;

import com.unifiedtree.settings.dto.SettingsDtos.CreateHolidayRequest;
import com.unifiedtree.settings.dto.SettingsDtos.HolidayResponse;
import com.unifiedtree.settings.dto.SettingsDtos.HrConfigResponse;
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
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public HrConfigResponse getHrConfig(@RequestParam UUID companyId) {
        return hrConfig.getOrDefault(companyId);
    }

    @PutMapping("/hr-configuration")
    @PreAuthorize("hasAuthority('settings.hrconfig.write')")
    public HrConfigResponse updateHrConfig(@RequestParam UUID companyId,
                                           @Valid @RequestBody UpdateHrConfigRequest req) {
        return hrConfig.update(companyId, req);
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
