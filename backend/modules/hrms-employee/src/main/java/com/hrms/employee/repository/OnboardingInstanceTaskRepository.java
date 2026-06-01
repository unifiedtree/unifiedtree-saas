package com.hrms.employee.repository;

import com.hrms.employee.entity.OnboardingInstanceTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OnboardingInstanceTaskRepository extends JpaRepository<OnboardingInstanceTask, UUID> {

    List<OnboardingInstanceTask> findByInstanceIdOrderBySequenceNoAsc(UUID instanceId);

    List<OnboardingInstanceTask> findByInstanceIdAndStatus(UUID instanceId, String status);

    @Query("SELECT COUNT(t) FROM OnboardingInstanceTask t WHERE t.instanceId = :instanceId AND t.status != 'COMPLETED'")
    long countPendingByInstanceId(@Param("instanceId") UUID instanceId);
}
