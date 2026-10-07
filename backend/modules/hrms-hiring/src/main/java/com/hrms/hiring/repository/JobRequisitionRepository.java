package com.hrms.hiring.repository;

import com.hrms.hiring.entity.JobRequisition;
import com.hrms.hiring.enums.RequisitionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface JobRequisitionRepository extends JpaRepository<JobRequisition, UUID> {

    Page<JobRequisition> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<JobRequisition> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);

    Page<JobRequisition> findByStatusOrderByCreatedAtDesc(RequisitionStatus status, Pageable pageable);

    // ── Kept to a range of days (calendar everywhere, 7 Oct 2026): made in [start, end), India day bounds.
    // Same order as the lists above. Only used when the page sends ?from=&to=.

    @org.springframework.data.jpa.repository.Query("SELECT x FROM JobRequisition x WHERE x.createdAt >= :start AND x.createdAt < :end ORDER BY x.createdAt DESC")
    Page<JobRequisition> findCreatedIn(@org.springframework.data.repository.query.Param("start") java.time.Instant start,
                              @org.springframework.data.repository.query.Param("end") java.time.Instant end, Pageable pageable);

    @org.springframework.data.jpa.repository.Query("SELECT x FROM JobRequisition x WHERE x.companyId = :companyId AND x.createdAt >= :start AND x.createdAt < :end ORDER BY x.createdAt DESC")
    Page<JobRequisition> findByCompanyIdCreatedIn(@org.springframework.data.repository.query.Param("companyId") UUID companyId,
                                        @org.springframework.data.repository.query.Param("start") java.time.Instant start,
                                        @org.springframework.data.repository.query.Param("end") java.time.Instant end, Pageable pageable);
}
