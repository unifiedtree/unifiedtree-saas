package com.hrms.pli.repository;

import com.hrms.pli.entity.PliAward;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PliAwardRepository extends JpaRepository<PliAward, UUID> {

    Page<PliAward> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<PliAward> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    /** The awards list's status filter (BW-63). */
    Page<PliAward> findByStatusInOrderByCreatedAtDesc(java.util.Collection<com.hrms.pli.enums.PliStatus> statuses,
                                                      Pageable pageable);
}
