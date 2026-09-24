package com.hrms.hiring.repository;

import com.hrms.hiring.entity.HiringOffer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface HiringOfferRepository extends JpaRepository<HiringOffer, UUID> {
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select o from HiringOffer o where o.id = :id")
    java.util.Optional<HiringOffer> findForUpdate(@org.springframework.data.repository.query.Param("id") UUID id);

    Page<HiringOffer> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);

    /** The candidate's most recent accepted offer (source of CTC / joining date on conversion). */
    java.util.Optional<HiringOffer> findFirstByCandidateIdAndStatusOrderByRespondedAtDescCreatedAtDesc(UUID candidateId, com.hrms.hiring.enums.OfferStatus status);
    Page<HiringOffer> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
