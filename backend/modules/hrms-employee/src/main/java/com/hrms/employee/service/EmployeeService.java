package com.hrms.employee.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.dto.EmergencyContactRequest;
import com.hrms.employee.dto.EmergencyContactResponse;
import com.hrms.employee.dto.EmployeeOffboardedEvent;
import com.hrms.employee.dto.EmployeeOnboardedEvent;
import com.hrms.employee.dto.EmployeeResponse;
import com.hrms.employee.dto.EmployeeSummaryResponse;
import com.hrms.employee.dto.TerminationRequest;
import com.hrms.employee.dto.UpdateEmployeeRequest;
import com.hrms.employee.entity.EmergencyContact;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.mapper.EmergencyContactMapper;
import com.hrms.employee.mapper.EmployeeMapper;
import com.hrms.employee.repository.EmergencyContactRepository;
import com.hrms.employee.repository.EmployeeDocumentRepository;
import com.hrms.employee.repository.EmployeeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class EmployeeService {

    private static final Logger log = LoggerFactory.getLogger(EmployeeService.class);

    private static final String TOPIC_EMPLOYEE_ONBOARDED = "employee.onboarded.v1";
    private static final String TOPIC_EMPLOYEE_OFFBOARDED = "employee.offboarded.v1";

    private final EmployeeRepository employeeRepository;
    private final EmergencyContactRepository emergencyContactRepository;
    private final EmployeeDocumentRepository employeeDocumentRepository;
    private final EmployeeMapper employeeMapper;
    private final EmergencyContactMapper emergencyContactMapper;
    private final EmployeeCodeGenerator employeeCodeGenerator;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final OnboardingService onboardingService;
    private final boolean kafkaEnabled;

    public EmployeeService(
            EmployeeRepository employeeRepository,
            EmergencyContactRepository emergencyContactRepository,
            EmployeeDocumentRepository employeeDocumentRepository,
            EmployeeMapper employeeMapper,
            EmergencyContactMapper emergencyContactMapper,
            EmployeeCodeGenerator employeeCodeGenerator,
            KafkaTemplate<String, Object> kafkaTemplate,
            OnboardingService onboardingService,
            @Value("${hrms.kafka.enabled:false}") boolean kafkaEnabled) {
        this.employeeRepository = employeeRepository;
        this.emergencyContactRepository = emergencyContactRepository;
        this.employeeDocumentRepository = employeeDocumentRepository;
        this.employeeMapper = employeeMapper;
        this.emergencyContactMapper = emergencyContactMapper;
        this.employeeCodeGenerator = employeeCodeGenerator;
        this.kafkaTemplate = kafkaTemplate;
        this.onboardingService = onboardingService;
        this.kafkaEnabled = kafkaEnabled;
    }

    @Transactional
    public EmployeeResponse createEmployee(CreateEmployeeRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw new BusinessRuleException("Tenant context is missing for employee creation.", "TENANT_CONTEXT_MISSING");
        }

        boolean emailExists = employeeRepository.findByEmail(request.email()).isPresent();
        if (emailExists) {
            throw new BusinessRuleException(
                    "An employee with email '" + request.email() + "' already exists in this tenant.");
        }

        Employee employee = employeeMapper.toEntity(request);
        employee.setTenantId(tenantId);
        employee.setEmployeeCode(employeeCodeGenerator.generate());
        employee.setEmploymentStatus(EmploymentStatus.ACTIVE);

        Employee saved = employeeRepository.save(employee);
        log.info("Employee created: id={}, code={}, email={}", saved.getId(), saved.getEmployeeCode(), saved.getEmail());

        if (request.onboardingTemplateId() != null) {
            try {
                onboardingService.createInstanceForEmployee(
                        saved.getId(), request.onboardingTemplateId(), request.dateOfJoining());
            } catch (Exception e) {
                log.warn("Failed to create onboarding instance for employeeId={}: {}", saved.getId(), e.getMessage());
            }
        }

        publishEmployeeOnboarded(saved);

        return employeeMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public EmployeeResponse getEmployee(UUID employeeId) {
        Employee employee = findEmployeeById(employeeId);
        return employeeMapper.toResponse(employee);
    }

    @Transactional(readOnly = true)
    public PageResponse<EmployeeSummaryResponse> listEmployees(UUID companyId, Pageable pageable) {
        Page<Employee> page = employeeRepository.findByCompanyId(companyId, pageable);
        return toPageResponse(page.map(employeeMapper::toSummary));
    }

    @Transactional(readOnly = true)
    public PageResponse<EmployeeSummaryResponse> listByDepartment(UUID departmentId, Pageable pageable) {
        Page<Employee> page = employeeRepository.findByDepartmentId(departmentId, pageable);
        return toPageResponse(page.map(employeeMapper::toSummary));
    }

    @Transactional
    public EmployeeResponse updateEmployee(UUID employeeId, UpdateEmployeeRequest request) {
        Employee employee = findEmployeeById(employeeId);

        if (request.firstName() != null) {
            employee.setFirstName(request.firstName());
        }
        if (request.lastName() != null) {
            employee.setLastName(request.lastName());
        }
        if (request.phone() != null) {
            employee.setPhone(request.phone());
        }
        if (request.departmentId() != null) {
            employee.setDepartmentId(request.departmentId());
        }
        if (request.branchId() != null) {
            employee.setBranchId(request.branchId());
        }
        if (request.geoFenceZoneId() != null) {
            employee.setGeoFenceZoneId(request.geoFenceZoneId());
        }
        if (request.managerId() != null) {
            employee.setManagerId(request.managerId());
        }
        if (request.jobTitle() != null) {
            employee.setJobTitle(request.jobTitle());
        }
        if (request.employmentType() != null) {
            employee.setEmploymentType(request.employmentType());
        }
        if (request.workLocation() != null) {
            employee.setWorkLocation(request.workLocation());
        }
        if (request.salaryFrequency() != null) {
            employee.setSalaryFrequency(request.salaryFrequency());
        }
        if (request.monthlySalary() != null) {
            employee.setMonthlySalary(request.monthlySalary());
        }
        if (request.panNumber() != null) {
            employee.setPanNumber(request.panNumber());
        }
        if (request.aadhaarNumber() != null) {
            employee.setAadhaarNumber(request.aadhaarNumber());
        }
        if (request.uanNumber() != null) {
            employee.setUanNumber(request.uanNumber());
        }
        if (request.esiNumber() != null) {
            employee.setEsiNumber(request.esiNumber());
        }
        if (request.bankAccountNumber() != null) {
            employee.setBankAccountNumber(request.bankAccountNumber());
        }
        if (request.bankIfscCode() != null) {
            employee.setBankIfscCode(request.bankIfscCode());
        }
        if (request.bankName() != null) {
            employee.setBankName(request.bankName());
        }
        if (request.bankBranchName() != null) {
            employee.setBankBranchName(request.bankBranchName());
        }

        Employee saved = employeeRepository.save(employee);
        log.info("Employee updated: id={}", saved.getId());
        return employeeMapper.toResponse(saved);
    }

    /**
     * Assign (or clear) the geofence zone an employee must punch in at. A null
     * {@code zoneId} clears the assignment (falls back to branch / no fence).
     * Kept as a dedicated method because the generic {@link #updateEmployee}
     * "apply when non-null" convention cannot express "clear to null".
     */
    @Transactional
    public EmployeeResponse assignPunchZone(UUID employeeId, UUID zoneId) {
        Employee employee = findEmployeeById(employeeId);
        employee.setGeoFenceZoneId(zoneId);
        Employee saved = employeeRepository.save(employee);
        log.info("Employee {} punch zone set to {}", employeeId, zoneId);
        return employeeMapper.toResponse(saved);
    }

    /**
     * Set an employee's weekly off days. {@code days} is a CSV of ISO day
     * numbers (1=Mon..7=Sun), e.g. "6,7" for Sat+Sun. A blank/null value clears
     * to the Sat+Sun default. Invalid tokens are dropped; an all-invalid input
     * falls back to "6,7" so attendance math always has a sane week-off set.
     */
    @Transactional
    public EmployeeResponse setWeeklyOffDays(UUID employeeId, String days) {
        Employee employee = findEmployeeById(employeeId);
        String normalized = normalizeWeeklyOffDays(days);
        employee.setWeeklyOffDays(normalized);
        Employee saved = employeeRepository.save(employee);
        log.info("Employee {} weekly off days set to {}", employeeId, normalized);
        return employeeMapper.toResponse(saved);
    }

    /** Keep only valid 1..7 day numbers, de-duplicated and ordered; default "6,7". */
    private String normalizeWeeklyOffDays(String days) {
        if (days == null || days.isBlank()) return "6,7";
        java.util.TreeSet<Integer> set = new java.util.TreeSet<>();
        for (String tok : days.split(",")) {
            try {
                int d = Integer.parseInt(tok.trim());
                if (d >= 1 && d <= 7) set.add(d);
            } catch (NumberFormatException ignored) { /* skip junk */ }
        }
        if (set.isEmpty()) return "6,7";
        return set.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(","));
    }

    @Transactional
    public void terminateEmployee(UUID employeeId, TerminationRequest request) {
        Employee employee = findEmployeeById(employeeId);

        EmploymentStatus newStatus = request.isResignation()
                ? EmploymentStatus.RESIGNED
                : EmploymentStatus.TERMINATED;

        employee.setEmploymentStatus(newStatus);
        employee.setDateOfTermination(request.dateOfTermination());

        employeeRepository.save(employee);
        log.info("Employee terminated: id={}, status={}, dateOfTermination={}",
                employee.getId(), newStatus, request.dateOfTermination());

        publishEmployeeOffboarded(employee, request);
    }

    @Transactional
    public void enrollFace(UUID employeeId, byte[] embedding) {
        Employee employee = findEmployeeById(employeeId);

        // TODO: Encrypt the face embedding before storing (e.g., using AES-256 via a KMS-backed key).
        // The raw embedding should never be persisted in plaintext.
        employee.setFaceEmbedding(embedding);
        employee.setFaceEnrolled(true);

        employeeRepository.save(employee);
        log.info("Face enrolled for employeeId={}", employeeId);
    }

    @Transactional
    public EmergencyContactResponse addEmergencyContact(UUID employeeId, EmergencyContactRequest request) {
        // Verify employee exists
        findEmployeeById(employeeId);

        EmergencyContact contact = emergencyContactMapper.toEntity(request);
        contact.setEmployeeId(employeeId);

        EmergencyContact saved = emergencyContactRepository.save(contact);
        log.info("Emergency contact added: id={}, employeeId={}", saved.getId(), employeeId);
        return emergencyContactMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<EmergencyContactResponse> getEmergencyContacts(UUID employeeId) {
        // Verify employee exists
        findEmployeeById(employeeId);

        return emergencyContactRepository.findByEmployeeId(employeeId)
                .stream()
                .map(emergencyContactMapper::toResponse)
                .toList();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private Employee findEmployeeById(UUID employeeId) {
        return employeeRepository.findById(employeeId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Employee not found with id: " + employeeId));
    }

    private void publishEmployeeOnboarded(Employee saved) {
        if (!kafkaEnabled) {
            return;
        }
        try {
            EmployeeOnboardedEvent event = new EmployeeOnboardedEvent(
                    saved.getId(),
                    saved.getTenantId(),
                    saved.getCompanyId(),
                    saved.getDepartmentId(),
                    saved.getEmail(),
                    Instant.now());
            kafkaTemplate.send(TOPIC_EMPLOYEE_ONBOARDED, saved.getId().toString(), event);
            log.info("Published {} event for employeeId={}", TOPIC_EMPLOYEE_ONBOARDED, saved.getId());
        } catch (Exception e) {
            log.warn("Failed to publish {} for employeeId={}: {}",
                    TOPIC_EMPLOYEE_ONBOARDED, saved.getId(), e.getMessage());
        }
    }

    private void publishEmployeeOffboarded(Employee employee, TerminationRequest request) {
        if (!kafkaEnabled) {
            return;
        }
        try {
            EmployeeOffboardedEvent event = new EmployeeOffboardedEvent(
                    employee.getId(),
                    employee.getTenantId(),
                    employee.getCompanyId(),
                    employee.getEmail(),
                    request.dateOfTermination(),
                    request.isResignation(),
                    Instant.now());
            kafkaTemplate.send(TOPIC_EMPLOYEE_OFFBOARDED, employee.getId().toString(), event);
            log.info("Published {} event for employeeId={}", TOPIC_EMPLOYEE_OFFBOARDED, employee.getId());
        } catch (Exception e) {
            log.warn("Failed to publish {} for employeeId={}: {}",
                    TOPIC_EMPLOYEE_OFFBOARDED, employee.getId(), e.getMessage());
        }
    }

    private <T> PageResponse<T> toPageResponse(Page<T> page) {
        return new PageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.isLast());
    }
}
