package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveTypeRequest;
import com.hrms.leave.dto.LeaveTypeResponse;
import com.hrms.leave.entity.LeaveType;
import com.hrms.leave.mapper.LeaveTypeMapper;
import com.hrms.leave.repository.LeaveTypeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class LeaveTypeService {

    private static final Logger log = LoggerFactory.getLogger(LeaveTypeService.class);

    private final LeaveTypeRepository leaveTypeRepository;
    private final LeaveTypeMapper leaveTypeMapper;

    public LeaveTypeService(LeaveTypeRepository leaveTypeRepository, LeaveTypeMapper leaveTypeMapper) {
        this.leaveTypeRepository = leaveTypeRepository;
        this.leaveTypeMapper = leaveTypeMapper;
    }

    @Transactional
    public LeaveTypeResponse createLeaveType(UUID companyId, LeaveTypeRequest request) {
        log.info("Creating leave type code={} for company={}", request.code(), companyId);

        leaveTypeRepository.findByCompanyIdAndCode(companyId, request.code())
                .ifPresent(existing -> {
                    throw new BusinessRuleException(
                            "Leave type with code '%s' already exists for this company".formatted(request.code()),
                            "LEAVE_TYPE_CODE_DUPLICATE");
                });

        LeaveType leaveType = new LeaveType();
        leaveType.setTenantId(TenantContext.getTenantId());
        leaveType.setCompanyId(companyId);
        leaveType.setName(request.name());
        leaveType.setCode(request.code());
        leaveType.setCategory(request.category());
        leaveType.setAnnualEntitlement(request.annualEntitlement());
        leaveType.setMaxConsecutiveDays(request.maxConsecutiveDays());
        leaveType.setMinNoticeDays(request.minNoticeDays());
        leaveType.setCarryForwardAllowed(request.isCarryForwardAllowed());
        leaveType.setMaxCarryForwardDays(request.maxCarryForwardDays());
        leaveType.setPaidLeave(request.isPaidLeave());
        leaveType.setApplicableGender(request.applicableGender());
        leaveType.setDescription(request.description());
        leaveType.setActive(true);

        leaveType = leaveTypeRepository.save(leaveType);
        log.info("Leave type created id={}", leaveType.getId());
        return leaveTypeMapper.toResponse(leaveType);
    }

    @Transactional(readOnly = true)
    public LeaveTypeResponse getLeaveType(UUID leaveTypeId) {
        log.debug("Fetching leave type id={}", leaveTypeId);
        LeaveType leaveType = leaveTypeRepository.findById(leaveTypeId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveType", leaveTypeId));
        return leaveTypeMapper.toResponse(leaveType);
    }

    @Transactional(readOnly = true)
    public List<LeaveTypeResponse> listLeaveTypes(UUID companyId) {
        log.debug("Listing active leave types for company={}", companyId);
        return leaveTypeRepository.findByCompanyIdAndActiveTrue(companyId)
                .stream()
                .map(leaveTypeMapper::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public LeaveTypeResponse updateLeaveType(UUID leaveTypeId, LeaveTypeRequest request) {
        log.info("Updating leave type id={}", leaveTypeId);

        LeaveType leaveType = leaveTypeRepository.findById(leaveTypeId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveType", leaveTypeId));

        // Check code uniqueness if code is changing
        if (!leaveType.getCode().equals(request.code())) {
            leaveTypeRepository.findByCompanyIdAndCode(leaveType.getCompanyId(), request.code())
                    .ifPresent(existing -> {
                        throw new BusinessRuleException(
                                "Leave type with code '%s' already exists for this company".formatted(request.code()),
                                "LEAVE_TYPE_CODE_DUPLICATE");
                    });
        }

        leaveType.setName(request.name());
        leaveType.setCode(request.code());
        leaveType.setCategory(request.category());
        leaveType.setAnnualEntitlement(request.annualEntitlement());
        leaveType.setMaxConsecutiveDays(request.maxConsecutiveDays());
        leaveType.setMinNoticeDays(request.minNoticeDays());
        leaveType.setCarryForwardAllowed(request.isCarryForwardAllowed());
        leaveType.setMaxCarryForwardDays(request.maxCarryForwardDays());
        leaveType.setPaidLeave(request.isPaidLeave());
        leaveType.setApplicableGender(request.applicableGender());
        leaveType.setDescription(request.description());

        leaveType = leaveTypeRepository.save(leaveType);
        log.info("Leave type updated id={}", leaveTypeId);
        return leaveTypeMapper.toResponse(leaveType);
    }

    @Transactional
    public void deactivateLeaveType(UUID leaveTypeId) {
        log.info("Deactivating leave type id={}", leaveTypeId);
        LeaveType leaveType = leaveTypeRepository.findById(leaveTypeId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveType", leaveTypeId));
        leaveType.setActive(false);
        leaveTypeRepository.save(leaveType);
        log.info("Leave type deactivated id={}", leaveTypeId);
    }
}
