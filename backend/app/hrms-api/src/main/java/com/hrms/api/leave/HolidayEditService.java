package com.hrms.api.leave;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.settings.dto.SettingsDtos.HolidayResponse;
import com.unifiedtree.settings.entity.Holiday;
import com.unifiedtree.settings.repository.HolidayRepository;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Edit a holiday (Leave → Holidays, HRMS redesign BW-46), for
 * {@code PUT /v1/settings/holidays/{id}}. Only the fields the holiday already
 * has and that adding one sets: date (and so its year), name, type and
 * description. The company stays; an archived holiday can't be edited.
 *
 * <p>Like adding or archiving a holiday today, this changes which days count
 * from now on; requests already made keep the days they were given.
 */
@Service
public class HolidayEditService {

    private final HolidayRepository repository;

    public HolidayEditService(HolidayRepository repository) {
        this.repository = repository;
    }

    /** The holiday as edited. A null type keeps the current type; a blank description clears it. */
    public record UpdateHolidayRequest(
            @NotNull(message = "Choose the date") LocalDate holidayDate,
            @NotBlank(message = "Give the holiday a name")
            @Size(max = 150, message = "Keep the name under 150 characters") String holidayName,
            Holiday.HolidayType holidayType,
            String description) {}

    @Transactional
    public HolidayResponse update(UUID id, UpdateHolidayRequest req) {
        UUID tenantId = TenantContext.getTenantId();
        Holiday h = repository.findById(id)
                .filter(Holiday::isActive)
                .filter(x -> tenantId == null || tenantId.equals(x.getTenantId()))
                .orElseThrow(() -> new ResourceNotFoundException("Holiday " + id + " not found"));
        h.setHolidayDate(req.holidayDate());
        h.setYear(req.holidayDate().getYear());
        h.setHolidayName(req.holidayName().trim());
        if (req.holidayType() != null) h.setHolidayType(req.holidayType());
        h.setDescription(req.description() == null || req.description().isBlank() ? null : req.description().trim());
        Holiday saved = repository.save(h);
        return new HolidayResponse(saved.getId(), saved.getCompanyId(), saved.getYear(), saved.getHolidayDate(),
                saved.getHolidayName(), saved.getHolidayType(), saved.getDescription(), saved.isActive());
    }
}
