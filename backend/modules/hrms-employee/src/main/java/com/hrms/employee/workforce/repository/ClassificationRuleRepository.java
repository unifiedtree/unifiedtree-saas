package com.hrms.employee.workforce.repository;

import com.hrms.employee.workforce.entity.ClassificationRule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ClassificationRuleRepository extends JpaRepository<ClassificationRule, UUID> {
    List<ClassificationRule> findAllByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);
}
