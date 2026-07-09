package com.unifiedtree.notifications.repository;

import com.unifiedtree.notifications.entity.AppNotification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * All finder methods filter by {@code userId} — the source-of-truth for
 * user-scoped visibility. Never expose a "find by id" without the userId
 * predicate; RLS covers tenant boundaries but there is no user GUC.
 */
@Repository
public interface AppNotificationRepository extends JpaRepository<AppNotification, UUID> {

    Page<AppNotification> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    Page<AppNotification> findByUserIdAndReadAtIsNullOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    long countByUserIdAndReadAtIsNull(UUID userId);

    Optional<AppNotification> findByIdAndUserId(UUID id, UUID userId);

    @Modifying
    @Query("UPDATE AppNotification n SET n.readAt = CURRENT_TIMESTAMP, n.updatedAt = CURRENT_TIMESTAMP "
            + "WHERE n.userId = :userId AND n.readAt IS NULL")
    int markAllRead(@Param("userId") UUID userId);
}
