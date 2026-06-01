package com.unifiedtree.settings.dto;

import com.unifiedtree.settings.entity.Holiday;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public final class SettingsDtos {
    private SettingsDtos() {}

    public record HrConfigResponse(
            UUID id,
            UUID companyId,
            String fiscalYearStart,
            Integer defaultNoticePeriodDays,
            Integer probationPeriodMonths,
            Integer retirementAge,
            boolean enableLateAutoDeduction,
            Integer lateGraceMinutes,
            boolean enforceGeofencingForMobile,
            boolean allowWorkFromHome,
            Integer workweekStartDay,
            Integer[] weekendDays
    ) { }

    public record UpdateHrConfigRequest(
            String fiscalYearStart,
            @Min(0) Integer defaultNoticePeriodDays,
            @Min(0) Integer probationPeriodMonths,
            @Min(0) Integer retirementAge,
            Boolean enableLateAutoDeduction,
            @Min(0) Integer lateGraceMinutes,
            Boolean enforceGeofencingForMobile,
            Boolean allowWorkFromHome,
            Integer workweekStartDay,
            Integer[] weekendDays
    ) { }

    public record HolidayResponse(
            UUID id,
            UUID companyId,
            Integer year,
            LocalDate holidayDate,
            String holidayName,
            Holiday.HolidayType holidayType,
            String description,
            boolean active
    ) { }

    public record CreateHolidayRequest(
            @NotNull UUID companyId,
            @NotNull LocalDate holidayDate,
            @NotBlank String holidayName,
            Holiday.HolidayType holidayType,
            String description
    ) { }
}
