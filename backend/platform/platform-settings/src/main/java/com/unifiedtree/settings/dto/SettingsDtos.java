package com.unifiedtree.settings.dto;

import com.unifiedtree.settings.entity.Holiday;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

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
            Integer[] weekendDays,
            String employeeCodePrefix,
            Long employeeCodeNextNumber,
            Integer employeeCodePadding
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
            Integer[] weekendDays,
            // Prefix: 1..10 alphanumeric chars (no dash, no spaces — the "-" is
            // inserted by the formatter). If null, keep existing value.
            @Pattern(regexp = "^[A-Za-z0-9]{1,10}$", message = "Prefix must be 1-10 letters or digits") String employeeCodePrefix,
            @Min(1) Long employeeCodeNextNumber,
            @Min(1) @Max(8) Integer employeeCodePadding
    ) { }

    /** Preview of the next employee code that would be issued for a company. */
    public record NextEmployeeCodeResponse(
            String preview,
            String prefix,
            Long nextNumber,
            Integer padding
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
