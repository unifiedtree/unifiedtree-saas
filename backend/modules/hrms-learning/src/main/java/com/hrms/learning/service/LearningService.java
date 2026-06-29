package com.hrms.learning.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.learning.dto.CompleteEnrollmentRequest;
import com.hrms.learning.dto.EnrollmentResponse;
import com.hrms.learning.dto.ProgramStatusRequest;
import com.hrms.learning.dto.TrainingProgramRequest;
import com.hrms.learning.dto.TrainingProgramResponse;
import com.hrms.learning.entity.TrainingEnrollment;
import com.hrms.learning.entity.TrainingProgram;
import com.hrms.learning.enums.EnrollmentStatus;
import com.hrms.learning.enums.ProgramStatus;
import com.hrms.learning.repository.TrainingEnrollmentRepository;
import com.hrms.learning.repository.TrainingProgramRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class LearningService {

    private static final Logger log = LoggerFactory.getLogger(LearningService.class);

    private final TrainingProgramRepository programRepository;
    private final TrainingEnrollmentRepository enrollmentRepository;

    public LearningService(TrainingProgramRepository programRepository,
                           TrainingEnrollmentRepository enrollmentRepository) {
        this.programRepository = programRepository;
        this.enrollmentRepository = enrollmentRepository;
    }

    // ── Programs ─────────────────────────────────────────────────────────────

    @Transactional
    public TrainingProgramResponse createProgram(UUID companyId, TrainingProgramRequest request) {
        if (request.startDate() != null && request.endDate() != null
                && request.endDate().isBefore(request.startDate())) {
            throw new BusinessRuleException("End date cannot be before the start date", "LEARNING_INVALID_DATES");
        }
        if (request.capacity() != null && request.capacity() < 0) {
            throw new BusinessRuleException("Capacity cannot be negative", "LEARNING_INVALID_CAPACITY");
        }
        UUID resolvedCompany = request.companyId() != null ? request.companyId() : companyId;

        TrainingProgram program = new TrainingProgram();
        program.setTenantId(TenantContext.getTenantId());
        program.setCompanyId(resolvedCompany);
        program.setTitle(request.title());
        program.setDescription(request.description());
        program.setCategory(request.category());
        program.setTrainer(request.trainer());
        program.setStartDate(request.startDate());
        program.setEndDate(request.endDate());
        program.setCapacity(request.capacity());
        program.setStatus(ProgramStatus.PLANNED);
        program = programRepository.save(program);

        log.info("Training program created id={} title={} company={}", program.getId(), program.getTitle(), resolvedCompany);
        return toProgram(program);
    }

    @Transactional(readOnly = true)
    public PageResponse<TrainingProgramResponse> listPrograms(Pageable pageable) {
        Page<TrainingProgram> page = programRepository.findAllByOrderByCreatedAtDesc(pageable);
        List<TrainingProgramResponse> content = page.getContent().stream()
                .map(this::toProgram)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional(readOnly = true)
    public TrainingProgramResponse getProgram(UUID programId) {
        return toProgram(loadProgram(programId));
    }

    @Transactional
    public TrainingProgramResponse changeStatus(UUID programId, ProgramStatusRequest request) {
        TrainingProgram program = loadProgram(programId);
        if (program.getStatus() == ProgramStatus.COMPLETED || program.getStatus() == ProgramStatus.CANCELLED) {
            throw new BusinessRuleException(
                    "A " + program.getStatus() + " program can no longer change status",
                    "LEARNING_PROGRAM_TERMINAL");
        }
        program.setStatus(request.status());
        program = programRepository.save(program);
        log.info("Training program {} status changed to {}", programId, request.status());
        return toProgram(program);
    }

    // ── Enrollments ──────────────────────────────────────────────────────────

    @Transactional
    public EnrollmentResponse enroll(UUID programId, UUID employeeId) {
        TrainingProgram program = loadProgram(programId);
        if (program.getStatus() == ProgramStatus.COMPLETED || program.getStatus() == ProgramStatus.CANCELLED) {
            throw new BusinessRuleException(
                    "Cannot enroll in a " + program.getStatus() + " program",
                    "LEARNING_PROGRAM_CLOSED");
        }
        if (enrollmentRepository.existsByProgramIdAndEmployeeId(programId, employeeId)) {
            throw new BusinessRuleException("You are already enrolled in this program", "LEARNING_ALREADY_ENROLLED");
        }
        if (program.getCapacity() != null
                && enrollmentRepository.countByProgramId(programId) >= program.getCapacity()) {
            throw new BusinessRuleException("This program is full", "LEARNING_PROGRAM_FULL");
        }

        TrainingEnrollment enrollment = new TrainingEnrollment();
        enrollment.setTenantId(TenantContext.getTenantId());
        enrollment.setProgramId(programId);
        enrollment.setEmployeeId(employeeId);
        enrollment.setStatus(EnrollmentStatus.ENROLLED);
        enrollment = enrollmentRepository.save(enrollment);

        log.info("Employee {} enrolled in program {}", employeeId, programId);
        return toEnrollment(enrollment, program.getTitle());
    }

    @Transactional(readOnly = true)
    public List<EnrollmentResponse> getProgramEnrollments(UUID programId) {
        TrainingProgram program = loadProgram(programId);
        return enrollmentRepository.findByProgramIdOrderByCreatedAtDesc(programId).stream()
                .map(e -> toEnrollment(e, program.getTitle()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<EnrollmentResponse> getMyEnrollments(UUID employeeId) {
        List<TrainingEnrollment> enrollments = enrollmentRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId);
        return enrollments.stream()
                .map(e -> toEnrollment(e, programRepository.findById(e.getProgramId())
                        .map(TrainingProgram::getTitle).orElse(null)))
                .toList();
    }

    @Transactional
    public EnrollmentResponse completeEnrollment(UUID enrollmentId, CompleteEnrollmentRequest request) {
        TrainingEnrollment enrollment = enrollmentRepository.findById(enrollmentId)
                .orElseThrow(() -> new ResourceNotFoundException("TrainingEnrollment", enrollmentId));
        if (enrollment.getStatus() == EnrollmentStatus.COMPLETED) {
            throw new BusinessRuleException("This enrollment is already completed", "LEARNING_ALREADY_COMPLETED");
        }
        if (enrollment.getStatus() == EnrollmentStatus.DROPPED) {
            throw new BusinessRuleException("A dropped enrollment cannot be completed", "LEARNING_ENROLLMENT_DROPPED");
        }
        enrollment.setStatus(EnrollmentStatus.COMPLETED);
        enrollment.setCompletedAt(Instant.now());
        enrollment.setScore(request.score());
        enrollment = enrollmentRepository.save(enrollment);

        String programTitle = programRepository.findById(enrollment.getProgramId())
                .map(TrainingProgram::getTitle).orElse(null);
        log.info("Enrollment {} marked complete score={}", enrollmentId, request.score());
        return toEnrollment(enrollment, programTitle);
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    private TrainingProgram loadProgram(UUID programId) {
        return programRepository.findById(programId)
                .orElseThrow(() -> new ResourceNotFoundException("TrainingProgram", programId));
    }

    private TrainingProgramResponse toProgram(TrainingProgram p) {
        long enrolled = enrollmentRepository.countByProgramId(p.getId());
        return new TrainingProgramResponse(
                p.getId(), p.getCompanyId(), p.getTitle(), p.getDescription(),
                p.getCategory(), p.getTrainer(), p.getStartDate(), p.getEndDate(),
                p.getCapacity(), p.getStatus(), enrolled, p.getCreatedAt());
    }

    private EnrollmentResponse toEnrollment(TrainingEnrollment e, String programTitle) {
        return new EnrollmentResponse(
                e.getId(), e.getProgramId(), programTitle, e.getEmployeeId(),
                null, null, e.getStatus(), e.getCompletedAt(), e.getScore(), e.getCreatedAt());
    }
}
