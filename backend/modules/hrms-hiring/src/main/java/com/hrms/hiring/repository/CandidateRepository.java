package com.hrms.hiring.repository;

import com.hrms.hiring.entity.Candidate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CandidateRepository extends JpaRepository<Candidate, UUID> {

    List<Candidate> findByRequisitionIdOrderByCreatedAtAsc(UUID requisitionId);

    long countByRequisitionId(UUID requisitionId);

    void deleteByRequisitionId(UUID requisitionId);
}
