package com.hrms.api.invitation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InvitationTokenRepository extends JpaRepository<InvitationToken, UUID> {

    Optional<InvitationToken> findByTokenHashAndUsedAtIsNull(String tokenHash);

    @Modifying
    @Query("UPDATE InvitationToken t SET t.usedAt = :now WHERE t.userId = :userId AND t.purpose = :purpose AND t.usedAt IS NULL")
    int invalidatePreviousTokens(@Param("userId") UUID userId,
                                 @Param("purpose") String purpose,
                                 @Param("now") OffsetDateTime now);

    /**
     * Tokens for this user + purpose that (a) are still unused, (b) have not
     * expired, and (c) were created after {@code since}. Used by the invite-
     * dedup path to detect a concurrent duplicate call that already did the
     * work — see {@link InvitationService#sendInvitation}.
     */
    @Query("SELECT t FROM InvitationToken t " +
           "WHERE t.userId = :userId AND t.purpose = :purpose " +
           "  AND t.usedAt IS NULL AND t.expiresAt > CURRENT_TIMESTAMP " +
           "  AND t.createdAt >= :since " +
           "ORDER BY t.createdAt DESC")
    List<InvitationToken> findRecentUnused(@Param("userId") UUID userId,
                                           @Param("purpose") String purpose,
                                           @Param("since") OffsetDateTime since);
}
