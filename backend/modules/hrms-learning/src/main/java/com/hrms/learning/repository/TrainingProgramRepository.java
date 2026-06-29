package com.hrms.learning.repository;

import com.hrms.learning.entity.TrainingProgram;
import com.hrms.learning.enums.ProgramStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface TrainingProgramRepository extends JpaRepository<TrainingProgram, UUID> {

    Page<TrainingProgram> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<TrainingProgram> findByStatusOrderByCreatedAtDesc(ProgramStatus status, Pageable pageable);

    Page<TrainingProgram> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);
}
