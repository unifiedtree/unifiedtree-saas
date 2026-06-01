package com.hrms.letters.repository;

import com.hrms.letters.domain.LetterTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LetterTemplateRepository extends JpaRepository<LetterTemplate, UUID> {

    @Query("SELECT t FROM LetterTemplate t WHERE t.deletedAt IS NULL ORDER BY t.createdAt DESC")
    Page<LetterTemplate> findAllActive(Pageable pageable);

    @Query("SELECT t FROM LetterTemplate t WHERE t.id = :id AND t.deletedAt IS NULL")
    Optional<LetterTemplate> findActiveById(@Param("id") UUID id);

    @Query("SELECT t FROM LetterTemplate t WHERE t.companyId = :companyId AND t.deletedAt IS NULL ORDER BY t.type, t.name")
    List<LetterTemplate> findActiveByCompanyId(@Param("companyId") UUID companyId);

    @Query("SELECT COUNT(t) FROM LetterTemplate t WHERE t.companyId = :companyId AND t.type = :type AND t.deletedAt IS NULL")
    long countByCompanyIdAndType(@Param("companyId") UUID companyId, @Param("type") String type);
}
