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

    @Query("SELECT g FROM GeneratedLetter g WHERE g.id = :id AND g.deletedAt IS NULL")
    Optional<GeneratedLetter> findActiveById(@Param("id") UUID id);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.type = :type AND g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByType(@Param("type") String type, Pageable pageable);

    @Query("SELECT g FROM GeneratedLetter g WHERE g.status = :status AND g.deletedAt IS NULL ORDER BY g.createdAt DESC")
    Page<GeneratedLetter> findActiveByStatus(@Param("status") String status, Pageable pageable);
}
