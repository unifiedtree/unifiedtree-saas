package com.hrms.leave.repository;

import com.hrms.leave.entity.HolidayCalendar;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface HolidayCalendarRepository extends JpaRepository<HolidayCalendar, UUID> {

    List<HolidayCalendar> findByCompanyIdAndYear(UUID companyId, int year);

    Optional<HolidayCalendar> findByCompanyIdAndHolidayDate(UUID companyId, LocalDate holidayDate);
}
