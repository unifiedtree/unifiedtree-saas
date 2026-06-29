package com.hrms.notiftemplate.repository;

import com.hrms.notiftemplate.entity.NotificationTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface NotificationTemplateRepository extends JpaRepository<NotificationTemplate, UUID> {

    Page<NotificationTemplate> findByCompanyIdOrderByNameAsc(UUID companyId, Pageable pageable);

    Page<NotificationTemplate> findAllByOrderByNameAsc(Pageable pageable);
}
