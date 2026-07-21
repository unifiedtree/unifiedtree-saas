package com.unifiedtree.notifications.repository;

import com.unifiedtree.notifications.entity.AppNotification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
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

    /** Bulk-delete every notification the user has already read. */
    @Modifying
    @Query("DELETE FROM AppNotification n WHERE n.userId = :userId AND n.readAt IS NOT NULL")
    int deleteAllReadForUser(@Param("userId") UUID userId);

    /**
     * Nightly-cleanup query used by the scheduled sweeper. Deletes read rows
     * older than {@code readCutoff} AND unread rows older than {@code unreadCutoff}
     * across all tenants (bypasses per-user scoping so it can run as a system job).
     * Called from a scheduled cron; count returned so we can log volume.
     */
    @Modifying
    @Query("DELETE FROM AppNotification n WHERE (n.readAt IS NOT NULL AND n.readAt < :readCutoff) "
            + "OR (n.readAt IS NULL AND n.createdAt < :unreadCutoff)")
    int deleteStale(@Param("readCutoff") Instant readCutoff,
                    @Param("unreadCutoff") Instant unreadCutoff);

    /**
     * Find every notification (any user) whose {@code data} JSON has the given
     * request id under any of the standard keys. Used to auto-mark-as-read the
     * approver's "New leave request" alert the moment they act on the request.
     * Native query so we can hit the JSONB {@code data->>} operator directly.
     */
    @Query(value = "SELECT * FROM notif.notifications "
            + "WHERE (data->>'leaveRequestId' = :requestId "
            + "    OR data->>'wfhRequestId' = :requestId "
            + "    OR data->>'correctionId' = :requestId "
            + "    OR data->>'shiftChangeRequestId' = :requestId) "
            + "  AND read_at IS NULL",
            nativeQuery = true)
    List<AppNotification> findUnreadByRequestId(@Param("requestId") String requestId);
}
