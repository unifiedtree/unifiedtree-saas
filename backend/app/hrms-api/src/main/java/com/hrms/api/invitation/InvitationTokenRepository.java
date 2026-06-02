package com.hrms.api.invitation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface InvitationTokenRepository extends JpaRepository<InvitationToken, UUID> {

    Optional<InvitationToken> findByTokenHashAndUsedAtIsNull(String tokenHash);

    @Modifying
    @Query("UPDATE InvitationToken t SET t.usedAt = :now WHERE t.userId = :userId AND t.purpose = :purpose AND t.usedAt IS NULL")
    int invalidatePreviousTokens(@Param("userId") UUID userId,
                                 @Param("purpose") String purpose,
                                 @Param("now") OffsetDateTime now);
}
