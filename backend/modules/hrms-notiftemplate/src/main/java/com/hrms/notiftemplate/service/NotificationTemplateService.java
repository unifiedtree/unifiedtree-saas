package com.hrms.notiftemplate.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.notiftemplate.dto.NotificationTemplateRequest;
import com.hrms.notiftemplate.dto.NotificationTemplateResponse;
import com.hrms.notiftemplate.entity.NotificationTemplate;
import com.hrms.notiftemplate.repository.NotificationTemplateRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class NotificationTemplateService {

    private static final Logger log = LoggerFactory.getLogger(NotificationTemplateService.class);

    private final NotificationTemplateRepository templateRepository;

    public NotificationTemplateService(NotificationTemplateRepository templateRepository) {
        this.templateRepository = templateRepository;
    }

    @Transactional
    public NotificationTemplateResponse createTemplate(UUID companyId, NotificationTemplateRequest request) {
        UUID resolvedCompany = request.companyId() != null ? request.companyId() : companyId;
        log.info("Creating notification template name={} channel={} event={} company={}",
                request.name(), request.channel(), request.eventKey(), resolvedCompany);

        NotificationTemplate template = new NotificationTemplate();
        template.setTenantId(TenantContext.getTenantId());
        template.setCompanyId(resolvedCompany);
        apply(template, request);
        template.setActive(request.active() == null || request.active());

        template = templateRepository.save(template);
        return toResponse(template);
    }

    @Transactional(readOnly = true)
    public PageResponse<NotificationTemplateResponse> listTemplates(UUID companyId, Pageable pageable) {
        Page<NotificationTemplate> page = companyId != null
                ? templateRepository.findByCompanyIdOrderByNameAsc(companyId, pageable)
                : templateRepository.findAllByOrderByNameAsc(pageable);
        return toPage(page);
    }

    @Transactional(readOnly = true)
    public NotificationTemplateResponse getTemplate(UUID templateId) {
        NotificationTemplate template = templateRepository.findById(templateId)
                .orElseThrow(() -> new ResourceNotFoundException("NotificationTemplate", templateId));
        return toResponse(template);
    }

    @Transactional
    public NotificationTemplateResponse updateTemplate(UUID templateId, NotificationTemplateRequest request) {
        NotificationTemplate template = templateRepository.findById(templateId)
                .orElseThrow(() -> new ResourceNotFoundException("NotificationTemplate", templateId));
        apply(template, request);
        if (request.active() != null) {
            template.setActive(request.active());
        }
        template = templateRepository.save(template);
        return toResponse(template);
    }

    @Transactional
    public void deleteTemplate(UUID templateId) {
        NotificationTemplate template = templateRepository.findById(templateId)
                .orElseThrow(() -> new ResourceNotFoundException("NotificationTemplate", templateId));
        templateRepository.delete(template);
        log.info("Deleted notification template id={}", templateId);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private void apply(NotificationTemplate template, NotificationTemplateRequest request) {
        template.setName(request.name());
        template.setChannel(request.channel());
        template.setEventKey(request.eventKey());
        template.setSubject(request.subject());
        template.setBody(request.body());
    }

    private PageResponse<NotificationTemplateResponse> toPage(Page<NotificationTemplate> page) {
        return new PageResponse<>(
                page.getContent().stream().map(this::toResponse).toList(),
                page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private NotificationTemplateResponse toResponse(NotificationTemplate t) {
        return new NotificationTemplateResponse(
                t.getId(), t.getCompanyId(), t.getName(), t.getChannel(),
                t.getEventKey(), t.getSubject(), t.getBody(), t.isActive(), t.getCreatedAt());
    }
}
