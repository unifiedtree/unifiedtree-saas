package com.hrms.performance.repository;

import com.hrms.performance.entity.Goal;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface GoalRepository extends JpaRepository<Goal, UUID> {

    List<Goal> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId);
}
