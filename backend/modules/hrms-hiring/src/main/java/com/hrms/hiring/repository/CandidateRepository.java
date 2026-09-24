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

    /** Row lock for conversion, so two clicks cannot create two employees. */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select c from Candidate c where c.id = :id")
    java.util.Optional<Candidate> findForUpdate(@org.springframework.data.repository.query.Param("id") UUID id);

    void deleteByRequisitionId(UUID requisitionId);
}
