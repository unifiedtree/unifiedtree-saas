package com.hrms.integration.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.integration.dto.IntegrationConnectionRequest;
import com.hrms.integration.dto.IntegrationConnectionResponse;
import com.hrms.integration.entity.IntegrationConnection;
import com.hrms.integration.enums.IntegrationStatus;
import com.hrms.integration.repository.IntegrationConnectionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Integrations directory: register third-party connections, list them, toggle
 * their connected state, and remove them. Tenant id is stamped on create from
 * {@link TenantContext}; row visibility is enforced by RLS.
 */
@Service
public class IntegrationService {

    private static final Logger log = LoggerFactory.getLogger(IntegrationService.class);

    private final IntegrationConnectionRepository connectionRepository;

    public IntegrationService(IntegrationConnectionRepository connectionRepository) {
        this.connectionRepository = connectionRepository;
    }

    @Transactional
    public IntegrationConnectionResponse createConnection(IntegrationConnectionRequest request) {
        IntegrationConnection connection = new IntegrationConnection();
        connection.setTenantId(TenantContext.getTenantId());
        connection.setCompanyId(request.companyId());
        connection.setName(request.name());
        connection.setProvider(request.provider());
        connection.setCategory(request.category());
        connection.setConfigSummary(request.configSummary());
        connection.setStatus(IntegrationStatus.DISCONNECTED);
        connection = connectionRepository.save(connection);
        log.info("Integration connection created id={} provider={} company={}",
                connection.getId(), connection.getProvider(), connection.getCompanyId());
        return toResponse(connection);
    }

    @Transactional(readOnly = true)
    public PageResponse<IntegrationConnectionResponse> listConnections(UUID companyId, Pageable pageable) {
        Page<IntegrationConnection> page = companyId != null
                ? connectionRepository.findByCompanyIdOrderByCreatedAtDesc(companyId, pageable)
                : connectionRepository.findAllByOrderByCreatedAtDesc(pageable);
        List<IntegrationConnectionResponse> content = page.getContent().stream().map(this::toResponse).toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    /**
     * Flip the connection between CONNECTED and DISCONNECTED. Connecting (from any
     * non-connected state, incl. ERROR) records a fresh sync timestamp.
     */
    @Transactional
    public IntegrationConnectionResponse toggleConnection(UUID id) {
        IntegrationConnection connection = connectionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("IntegrationConnection", id));
        if (connection.getStatus() == IntegrationStatus.CONNECTED) {
            connection.setStatus(IntegrationStatus.DISCONNECTED);
        } else {
            connection.setStatus(IntegrationStatus.CONNECTED);
            connection.setLastSyncedAt(Instant.now());
        }
        connection = connectionRepository.save(connection);
        log.info("Integration connection {} toggled to {}", id, connection.getStatus());
        return toResponse(connection);
    }

    @Transactional
    public void deleteConnection(UUID id) {
        IntegrationConnection connection = connectionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("IntegrationConnection", id));
        connectionRepository.delete(connection);
        log.info("Integration connection {} removed", id);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private IntegrationConnectionResponse toResponse(IntegrationConnection c) {
        return new IntegrationConnectionResponse(
                c.getId(), c.getCompanyId(), c.getName(), c.getProvider(), c.getCategory(),
                c.getStatus(), c.getConfigSummary(), c.getLastSyncedAt(), c.getCreatedAt());
    }
}
