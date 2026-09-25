package com.hrms.hiring.repository;

import com.hrms.hiring.entity.Candidate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CandidateRepository extends JpaRepository<Candidate, UUID> {

    List<Candidate> findByRequisitionIdOrderByCreatedAtAsc(UUID requisitionId);

    /**
     * Every candidate across requisitions (the pipeline's "All roles" view and
     * the dashboard's stage counts), optionally for one company and one stage.
     */
    @org.springframework.data.jpa.repository.Query("""
            select c from Candidate c
             where (:companyId is null or c.requisitionId in
                    (select r.id from JobRequisition r where r.companyId = :companyId))
               and (:stage is null or c.stage = :stage)
             order by c.createdAt asc
            """)
    List<Candidate> findAcrossRequisitions(@org.springframework.data.repository.query.Param("companyId") UUID companyId,
                                           @org.springframework.data.repository.query.Param("stage") com.hrms.hiring.enums.CandidateStage stage);

    long countByRequisitionId(UUID requisitionId);

    /** Row lock for conversion, so two clicks cannot create two employees. */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select c from Candidate c where c.id = :id")
    java.util.Optional<Candidate> findForUpdate(@org.springframework.data.repository.query.Param("id") UUID id);

    void deleteByRequisitionId(UUID requisitionId);
}
