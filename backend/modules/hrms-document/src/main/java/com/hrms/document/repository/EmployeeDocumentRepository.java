package com.hrms.document.repository;

import com.hrms.document.entity.EmployeeDocument;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface EmployeeDocumentRepository extends JpaRepository<EmployeeDocument, UUID> {

    Page<EmployeeDocument> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);
}
