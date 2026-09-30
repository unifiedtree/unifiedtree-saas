package com.hrms.fnf.repository;

import com.hrms.fnf.entity.FnfSettlement;
import com.hrms.fnf.enums.FnfStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.UUID;

@Repository
public interface FnfSettlementRepository extends JpaRepository<FnfSettlement, UUID> {

    Page<FnfSettlement> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<FnfSettlement> findByStatusOrderByCreatedAtDesc(FnfStatus status, Pageable pageable);

    Page<FnfSettlement> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    /** The ledger's status tabs (BW-64). */
    Page<FnfSettlement> findByStatusInOrderByCreatedAtDesc(Collection<FnfStatus> statuses, Pageable pageable);

    /** One person's settlements in some statuses (BW-64). */
    Page<FnfSettlement> findByEmployeeIdAndStatusInOrderByCreatedAtDesc(UUID employeeId, Collection<FnfStatus> statuses,
                                                                        Pageable pageable);
}
