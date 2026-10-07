package com.hrms.fnf.repository;

import com.hrms.fnf.entity.FnfSettlement;
import com.hrms.fnf.enums.FnfStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
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

    // ── Kept to a range of last working days (calendar everywhere, 7 Oct 2026) ──
    // Same order as the lists above. Only used when the page sends ?from=&to=.

    /** The ledger in some statuses (all of them for no status filter), last working day in [from, to]. */
    Page<FnfSettlement> findByStatusInAndLastWorkingDayBetweenOrderByCreatedAtDesc(Collection<FnfStatus> statuses,
                                                                                    LocalDate from, LocalDate to,
                                                                                    Pageable pageable);

    /** One person's settlements in some statuses, last working day in [from, to]. */
    Page<FnfSettlement> findByEmployeeIdAndStatusInAndLastWorkingDayBetweenOrderByCreatedAtDesc(UUID employeeId,
                                                                                                 Collection<FnfStatus> statuses,
                                                                                                 LocalDate from, LocalDate to,
                                                                                                 Pageable pageable);
}
