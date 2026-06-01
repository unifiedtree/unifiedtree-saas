package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Shift;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ShiftRepository extends JpaRepository<Shift, UUID> {

    List<Shift> findByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);

    Optional<Shift> findByCompanyIdAndCode(UUID companyId, String code);
}
