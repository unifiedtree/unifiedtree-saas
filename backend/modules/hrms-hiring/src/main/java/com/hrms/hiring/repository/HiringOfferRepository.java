package com.hrms.hiring.repository;

import com.hrms.hiring.entity.HiringOffer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface HiringOfferRepository extends JpaRepository<HiringOffer, UUID> {
    Page<HiringOffer> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);
    Page<HiringOffer> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
