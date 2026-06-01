package com.hrms.employee.repository;

import com.hrms.employee.entity.OnboardingTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OnboardingTaskRepository extends JpaRepository<OnboardingTask, UUID> {

    List<OnboardingTask> findByTemplateIdOrderBySequenceNoAsc(UUID templateId);

    void deleteByTemplateId(UUID templateId);
}
