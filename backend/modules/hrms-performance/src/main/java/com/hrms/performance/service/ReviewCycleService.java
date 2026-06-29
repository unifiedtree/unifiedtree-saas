package com.hrms.performance.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.performance.dto.ReviewCycleRequest;
import com.hrms.performance.dto.ReviewCycleResponse;
import com.hrms.performance.entity.ReviewCycle;
import com.hrms.performance.enums.CycleStatus;
import com.hrms.performance.repository.ReviewCycleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ReviewCycleService {

    private static final Logger log = LoggerFactory.getLogger(ReviewCycleService.class);

    private final ReviewCycleRepository cycleRepository;

    public ReviewCycleService(ReviewCycleRepository cycleRepository) {
        this.cycleRepository = cycleRepository;
    }

    @Transactional
    public ReviewCycleResponse createCycle(UUID companyId, ReviewCycleRequest request) {
        UUID resolvedCompany = request.companyId() != null ? request.companyId() : companyId;
        log.info("Creating review cycle name={} company={}", request.name(), resolvedCompany);

        ReviewCycle cycle = new ReviewCycle();
        cycle.setTenantId(TenantContext.getTenantId());
        cycle.setCompanyId(resolvedCompany);
        cycle.setName(request.name());
        cycle.setPeriodStart(request.periodStart());
        cycle.setPeriodEnd(request.periodEnd());
        cycle.setStatus(CycleStatus.DRAFT);

        cycle = cycleRepository.save(cycle);
        return toResponse(cycle);
    }

    @Transactional(readOnly = true)
    public List<ReviewCycleResponse> listCycles() {
        return cycleRepository.findAllByOrderByPeriodStartDesc().stream().map(this::toResponse).toList();
    }

    @Transactional
    public ReviewCycleResponse activateCycle(UUID cycleId) {
        ReviewCycle cycle = cycleRepository.findById(cycleId)
                .orElseThrow(() -> new ResourceNotFoundException("ReviewCycle", cycleId));
        if (cycle.getStatus() == CycleStatus.CLOSED) {
            throw new BusinessRuleException(
                    "A closed review cycle cannot be re-activated", "PERFORMANCE_CYCLE_CLOSED");
        }
        cycle.setStatus(CycleStatus.ACTIVE);
        cycle = cycleRepository.save(cycle);
        log.info("Review cycle {} activated", cycleId);
        return toResponse(cycle);
    }

    private ReviewCycleResponse toResponse(ReviewCycle c) {
        return new ReviewCycleResponse(
                c.getId(), c.getCompanyId(), c.getName(),
                c.getPeriodStart(), c.getPeriodEnd(), c.getStatus(), c.getCreatedAt());
    }
}
