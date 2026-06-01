package com.hrms.attendance.repository;

import com.hrms.attendance.entity.GeoFenceAudit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface GeoFenceAuditRepository extends JpaRepository<GeoFenceAudit, UUID> {}
