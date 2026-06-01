package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.Grade;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface GradeRepository extends JpaRepository<Grade, UUID> {

    List<Grade> findByCompanyIdAndActiveTrueOrderByLevelAsc(UUID companyId);

    Optional<Grade> findByCompanyIdAndCode(UUID companyId, String code);

    boolean existsByCompanyIdAndCode(UUID companyId, String code);
}
