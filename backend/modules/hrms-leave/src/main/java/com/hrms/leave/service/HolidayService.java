package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.leave.dto.HolidayRequest;
import com.hrms.leave.dto.HolidayResponse;
import com.hrms.leave.entity.HolidayCalendar;
import com.hrms.leave.mapper.HolidayMapper;
import com.hrms.leave.repository.HolidayCalendarRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service("leaveHolidayService")
public class HolidayService {

    private static final Logger log = LoggerFactory.getLogger(HolidayService.class);

    private final HolidayCalendarRepository holidayCalendarRepository;
    private final HolidayMapper holidayMapper;

    public HolidayService(HolidayCalendarRepository holidayCalendarRepository, HolidayMapper holidayMapper) {
        this.holidayCalendarRepository = holidayCalendarRepository;
        this.holidayMapper = holidayMapper;
    }

    @Transactional
    public HolidayResponse addHoliday(UUID companyId, UUID tenantId, HolidayRequest request) {
        log.info("Adding holiday on {} for company={}", request.holidayDate(), companyId);

        holidayCalendarRepository.findByCompanyIdAndHolidayDate(companyId, request.holidayDate())
                .ifPresent(existing -> {
                    throw new BusinessRuleException(
                            "A holiday already exists on date %s for this company".formatted(request.holidayDate()),
                            "HOLIDAY_DATE_DUPLICATE");
                });

        HolidayCalendar holiday = new HolidayCalendar();
        holiday.setTenantId(tenantId);
        holiday.setCompanyId(companyId);
        holiday.setName(request.name());
        holiday.setHolidayDate(request.holidayDate());
        holiday.setYear(request.holidayDate().getYear());
        holiday.setOptional(request.isOptional());
        holiday.setDescription(request.description());

        holiday = holidayCalendarRepository.save(holiday);
        log.info("Holiday created id={} date={}", holiday.getId(), holiday.getHolidayDate());
        return holidayMapper.toResponse(holiday);
    }

    @Transactional(readOnly = true)
    public List<HolidayResponse> listHolidays(UUID companyId, int year) {
        log.debug("Listing holidays for company={} year={}", companyId, year);
        return holidayCalendarRepository.findByCompanyIdAndYear(companyId, year)
                .stream()
                .map(holidayMapper::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteHoliday(UUID holidayId) {
        log.info("Deleting holiday id={}", holidayId);
        HolidayCalendar holiday = holidayCalendarRepository.findById(holidayId)
                .orElseThrow(() -> new ResourceNotFoundException("HolidayCalendar", holidayId));
        holidayCalendarRepository.delete(holiday);
        log.info("Holiday deleted id={}", holidayId);
    }
}
