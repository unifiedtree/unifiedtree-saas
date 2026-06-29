package com.hrms.learning.repository;

import com.hrms.learning.entity.TrainingEnrollment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TrainingEnrollmentRepository extends JpaRepository<TrainingEnrollment, UUID> {

    List<TrainingEnrollment> findByProgramIdOrderByCreatedAtDesc(UUID programId);

    List<TrainingEnrollment> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId);

    boolean existsByProgramIdAndEmployeeId(UUID programId, UUID employeeId);

    long countByProgramId(UUID programId);
}
