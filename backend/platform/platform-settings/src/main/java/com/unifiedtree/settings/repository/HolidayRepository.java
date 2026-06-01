package com.unifiedtree.settings.repository;

import com.unifiedtree.settings.entity.Holiday;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public interface HolidayRepository extends JpaRepository<Holiday, UUID> {
    List<Holiday> findAllByCompanyIdAndYearAndActiveTrueOrderByHolidayDateAsc(UUID companyId, Integer year);
    List<Holiday> findAllByCompanyIdAndHolidayDateBetweenAndActiveTrueOrderByHolidayDateAsc(
            UUID companyId, LocalDate from, LocalDate to);
}
