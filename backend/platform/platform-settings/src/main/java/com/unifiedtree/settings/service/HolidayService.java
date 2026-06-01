package com.unifiedtree.settings.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.settings.dto.SettingsDtos.CreateHolidayRequest;
import com.unifiedtree.settings.dto.SettingsDtos.HolidayResponse;
import com.unifiedtree.settings.entity.Holiday;
import com.unifiedtree.settings.repository.HolidayRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class HolidayService {

    private final HolidayRepository repository;

    public HolidayService(HolidayRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<HolidayResponse> list(UUID companyId, Integer year) {
        return repository.findAllByCompanyIdAndYearAndActiveTrueOrderByHolidayDateAsc(
                companyId, year != null ? year : LocalDate.now().getYear())
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<HolidayResponse> between(UUID companyId, LocalDate from, LocalDate to) {
        return repository.findAllByCompanyIdAndHolidayDateBetweenAndActiveTrueOrderByHolidayDateAsc(companyId, from, to)
                .stream().map(this::toResponse).toList();
    }

    public HolidayResponse create(CreateHolidayRequest req) {
        Holiday h = new Holiday();
        h.setCompanyId(req.companyId());
        h.setYear(req.holidayDate().getYear());
        h.setHolidayDate(req.holidayDate());
        h.setHolidayName(req.holidayName());
        h.setHolidayType(req.holidayType() != null ? req.holidayType() : Holiday.HolidayType.COMPANY);
        h.setDescription(req.description());
        h.setActive(true);
        return toResponse(repository.save(h));
    }

    public void archive(UUID id) {
        Holiday h = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Holiday " + id + " not found"));
        h.setActive(false);
        repository.save(h);
    }

    private HolidayResponse toResponse(Holiday h) {
        return new HolidayResponse(
                h.getId(), h.getCompanyId(), h.getYear(), h.getHolidayDate(),
                h.getHolidayName(), h.getHolidayType(), h.getDescription(), h.isActive());
    }
}
