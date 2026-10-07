package com.hrms.letters.repository;

import com.hrms.letters.domain.GeneratedLetter;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface GeneratedLetterRepository extends JpaRepository<GeneratedLetter, UUID> {

    @Query("SELECT g FROM GeneratedLetter g WHERE g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findAllActive(Pageable pageable);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.employeeId = :employeeId AND g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByEmployeeId(@Param("employeeId") UUID employeeId, Pageable pageable);

    /**
     * The letters an employee is shown in My letters (redesign BW-75): letters
     * that were sent to them, by HR or in a distribution, and letters they have
     * opened or signed. A sent letter HR later voided stays (shown as withdrawn);
     * HR's unsent drafts, and drafts voided before they were sent, do not.
     */
    String SENT_TO_EMPLOYEE = "(g.sentAt IS NOT NULL OR g.status IN ('VIEWED', 'SIGNED') "
            + "OR EXISTS (SELECT 1 FROM DistributionRecipient r WHERE r.generatedLetterId = g.id AND r.sendStatus = 'SENT'))";

    @Query(value = "SELECT g FROM GeneratedLetter g WHERE g.employeeId = :employeeId AND g.deletedAt IS NULL AND "
            + SENT_TO_EMPLOYEE + " ORDER BY COALESCE(g.sentAt, g.createdAt) DESC",
            countQuery = "SELECT COUNT(g) FROM GeneratedLetter g WHERE g.employeeId = :employeeId AND g.deletedAt IS NULL AND "
                    + SENT_TO_EMPLOYEE)
    Page<GeneratedLetter> findSentToEmployee(@Param("employeeId") UUID employeeId, Pageable pageable);

    @Query("SELECT COUNT(g) > 0 FROM GeneratedLetter g WHERE g.id = :id AND g.deletedAt IS NULL AND " + SENT_TO_EMPLOYEE)
    boolean isSentToEmployee(@Param("id") UUID id);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.id = :id AND g.deletedAt IS NULL")
    Optional<GeneratedLetter> findActiveById(@Param("id") UUID id);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.type = :type AND g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByType(@Param("type") String type, Pageable pageable);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.status = :status AND g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByStatus(@Param("status") String status, Pageable pageable);

    // ── Kept to a range of days (calendar everywhere, 7 Oct 2026): generated in [start, end), India day bounds.
    // Same rows and order as findAllActive / findActiveByEmployeeId. Only used when the page sends ?from=&to=.

    @Query("SELECT g FROM GeneratedLetter g WHERE g.deletedAt IS NULL AND g.createdAt >= :start AND g.createdAt < :end ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findAllActiveCreatedIn(@Param("start") java.time.Instant start, @Param("end") java.time.Instant end,
                                                 Pageable pageable);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.employeeId = :employeeId AND g.deletedAt IS NULL"
            + " AND g.createdAt >= :start AND g.createdAt < :end ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByEmployeeIdCreatedIn(@Param("employeeId") UUID employeeId,
                                                          @Param("start") java.time.Instant start,
                                                          @Param("end") java.time.Instant end, Pageable pageable);
}
