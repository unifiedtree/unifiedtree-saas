package com.hrms.tenant.repository;

import com.hrms.tenant.entity.Department;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DepartmentRepository extends JpaRepository<Department, UUID> {

    Page<Department> findByCompanyId(UUID companyId, Pageable pageable);

    List<Department> findByCompanyId(UUID companyId);

    List<Department> findByParentDepartmentId(UUID parentDepartmentId);

    List<Department> findByCompanyIdAndIsActiveTrue(UUID companyId);
}
