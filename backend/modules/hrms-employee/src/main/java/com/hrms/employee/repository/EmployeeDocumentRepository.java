package com.hrms.employee.repository;

import com.hrms.employee.entity.EmployeeDocument;
import com.hrms.employee.enums.DocumentType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface EmployeeDocumentRepository extends JpaRepository<EmployeeDocument, UUID> {

    List<EmployeeDocument> findByEmployeeId(UUID employeeId);

    List<EmployeeDocument> findByEmployeeIdAndDocumentType(UUID employeeId, DocumentType documentType);
}
