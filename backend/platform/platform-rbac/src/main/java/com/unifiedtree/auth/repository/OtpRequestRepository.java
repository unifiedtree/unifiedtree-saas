package com.unifiedtree.auth.repository;

import com.unifiedtree.auth.entity.OtpRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * JPA repository for {@link OtpRequest}. Kept in
 * {@code com.unifiedtree.auth.repository} so the canonical-profile
 * {@code @EnableJpaRepositories} allow-list picks it up unchanged.
 */
@Repository
public interface OtpRequestRepository extends JpaRepository<OtpRequest, UUID> {

    /**
     * Rate-limit helper. Count OTP sends for a phone within a sliding window.
     * Only rows with {@code status IN ('SENT','VERIFIED','EXPIRED','REVOKED','LOCKED')}
     * count — every row is a send. Excludes rows that were only touched by
     * housekeeping (there are none today, but keeps future flexibility).
     */
    @Query("""
           SELECT COUNT(o) FROM OtpRequest o
             WHERE o.phoneLast10 = :phoneLast10
               AND o.sentAt >= :since
           """)
    long countSendsSince(@Param("phoneLast10") String phoneLast10,
                         @Param("since") OffsetDateTime since);

    /**
     * Latest send for a phone — used to enforce the resend cooldown.
     */
    @Query("""
           SELECT o FROM OtpRequest o
             WHERE o.phoneLast10 = :phoneLast10
             ORDER BY o.sentAt DESC
           """)
    List<OtpRequest> findRecentByPhone(@Param("phoneLast10") String phoneLast10,
                                       org.springframework.data.domain.Pageable pageable);

    /**
     * Revoke every still-SENT row for a phone in a single UPDATE. Called by
     * /request (start-of-new-code) and /resend (kill-old-before-new).
     */
    @Modifying
    @Query("""
           UPDATE OtpRequest o
              SET o.status = 'REVOKED', o.revokedAt = :now
            WHERE o.phoneLast10 = :phoneLast10
              AND o.status = 'SENT'
           """)
    int revokeActiveByPhone(@Param("phoneLast10") String phoneLast10,
                            @Param("now") OffsetDateTime now);
}
