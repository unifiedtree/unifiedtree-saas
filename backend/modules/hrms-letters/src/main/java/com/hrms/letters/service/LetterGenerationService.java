package com.hrms.letters.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.letters.domain.GeneratedLetter;
import com.hrms.letters.domain.LetterTemplate;
import com.hrms.letters.dto.*;
import com.hrms.letters.repository.GeneratedLetterRepository;
import com.hrms.letters.repository.LetterTemplateRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class LetterGenerationService {

    private static final Logger log = LoggerFactory.getLogger(LetterGenerationService.class);

    private final LetterTemplateRepository    templateRepo;
    private final GeneratedLetterRepository  generatedRepo;
    private final EmployeeRepository         employeeRepo;
    private final WorkforceCompanyRepository companyRepo;
    private final WorkforceDepartmentRepository departmentRepo;
    private final WorkforceBranchRepository  branchRepo;
    private final MergeFieldResolver         mergeFieldResolver;
    private final PdfRenderer                pdfRenderer;
    private final LetterStorageService       storageService;
    private final LetterEmailService         emailService;

    public LetterGenerationService(
            LetterTemplateRepository templateRepo,
            GeneratedLetterRepository generatedRepo,
            EmployeeRepository employeeRepo,
            WorkforceCompanyRepository companyRepo,
            WorkforceDepartmentRepository departmentRepo,
            WorkforceBranchRepository branchRepo,
            MergeFieldResolver mergeFieldResolver,
            PdfRenderer pdfRenderer,
            LetterStorageService storageService,
            LetterEmailService emailService) {
        this.templateRepo    = templateRepo;
        this.generatedRepo   = generatedRepo;
        this.employeeRepo    = employeeRepo;
        this.companyRepo     = companyRepo;
        this.departmentRepo  = departmentRepo;
        this.branchRepo      = branchRepo;
        this.mergeFieldResolver = mergeFieldResolver;
        this.pdfRenderer     = pdfRenderer;
        this.storageService  = storageService;
        this.emailService    = emailService;
    }

    @Transactional
    public GeneratedLetterDto generate(GenerateLetterRequest req, UUID generatedBy) {
        LetterTemplate template = requireTemplate(req.templateId());

        Employee employee = employeeRepo.findById(req.employeeId())
                .orElseThrow(() -> new HrmsException(
                        "Employee not found: " + req.employeeId(), HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND"));

        Company company = employee.getCompanyId() != null
                ? companyRepo.findById(employee.getCompanyId()).orElse(null) : null;
        Department department = employee.getDepartmentId() != null
                ? departmentRepo.findById(employee.getDepartmentId()).orElse(null) : null;
        Branch branch = employee.getBranchId() != null
                ? branchRepo.findById(employee.getBranchId()).orElse(null) : null;
        Employee manager = employee.getManagerId() != null
                ? employeeRepo.findById(employee.getManagerId()).orElse(null) : null;
        // Employee has no designationId FK — derive from jobTitle string
        Designation designation = null;
        if (employee.getJobTitle() != null) {
            designation = new Designation();
            designation.setTitle(employee.getJobTitle());
        }

        Map<String, String> ctx = mergeFieldResolver.buildContext(
                employee, company, department, designation, branch, manager,
                req.overrides() != null ? req.overrides() : Map.of());

        String renderedSubject = mergeFieldResolver.resolve(template.getSubject(), ctx);
        String renderedBody    = mergeFieldResolver.resolve(template.getBodyHtml(), ctx);

        byte[] pdfBytes = pdfRenderer.render(renderedBody);

        GeneratedLetter letter = new GeneratedLetter();
        letter.setCompanyId(employee.getCompanyId());
        letter.setTemplateId(template.getId());
        letter.setEmployeeId(employee.getId());
        letter.setType(template.getType());
        letter.setSubject(renderedSubject);
        letter.setBodyHtmlRendered(renderedBody);
        letter.setGeneratedBy(generatedBy);
        letter.setGenerationContext(ctx);
        letter.setStatus("GENERATED");
        generatedRepo.save(letter);

        String pdfPath = storageService.store(letter.getTenantId(), letter.getId(), pdfBytes);
        letter.setPdfPath(pdfPath);
        letter.setPdfSizeBytes((long) pdfBytes.length);
        generatedRepo.save(letter);

        log.info("Generated letter id={} type={} for employee={}", letter.getId(), letter.getType(), employee.getId());

        if (req.sendImmediately()) {
            String toEmail = req.sendToEmail() != null ? req.sendToEmail() : employee.getEmail();
            sendLetterInternal(letter, toEmail, null, pdfBytes);
        }

        return GeneratedLetterDto.from(letter);
    }

    @Transactional
    public GeneratedLetterDto sendLetter(UUID letterId, SendLetterRequest req) {
        GeneratedLetter letter = requireLetter(letterId);
        if ("VOID".equals(letter.getStatus())) {
            throw new HrmsException("Cannot send a voided letter", HttpStatus.BAD_REQUEST, "LETTER_VOIDED");
        }
        byte[] pdfBytes = storageService.load(letter.getPdfPath());
        String toEmail  = req.toEmail() != null ? req.toEmail()
                : employeeRepo.findById(letter.getEmployeeId())
                        .map(Employee::getEmail)
                        .orElseThrow(() -> new HrmsException("Employee not found", HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND"));
        sendLetterInternal(letter, toEmail, req.ccEmail(), pdfBytes);
        return GeneratedLetterDto.from(generatedRepo.save(letter));
    }

    @Transactional
    public GeneratedLetterDto voidLetter(UUID letterId, VoidLetterRequest req) {
        GeneratedLetter letter = requireLetter(letterId);
        if ("VOID".equals(letter.getStatus())) {
            throw new HrmsException("Letter is already voided", HttpStatus.BAD_REQUEST, "LETTER_ALREADY_VOIDED");
        }
        letter.setStatus("VOID");
        letter.setVoidedAt(Instant.now());
        letter.setVoidedReason(req.reason());
        log.info("Voided letter id={} reason={}", letterId, req.reason());
        return GeneratedLetterDto.from(generatedRepo.save(letter));
    }

    @Transactional(readOnly = true)
    public PageResponse<GeneratedLetterDto> listGenerated(Pageable pageable) {
        Page<GeneratedLetter> page = generatedRepo.findAllActive(pageable);
        return PageResponse.from(page, GeneratedLetterDto::from);
    }

    @Transactional(readOnly = true)
    public GeneratedLetterDto getGenerated(UUID id) {
        return GeneratedLetterDto.from(requireLetter(id));
    }

    @Transactional(readOnly = true)
    public PageResponse<GeneratedLetterDto> getMyLetters(UUID employeeId, Pageable pageable) {
        Page<GeneratedLetter> page = generatedRepo.findActiveByEmployeeId(employeeId, pageable);
        return PageResponse.from(page, GeneratedLetterDto::from);
    }

    public byte[] getPdf(UUID letterId) {
        GeneratedLetter letter = requireLetter(letterId);
        if (letter.getPdfPath() == null || !storageService.exists(letter.getPdfPath())) {
            throw new HrmsException("PDF not available for letter " + letterId, HttpStatus.NOT_FOUND, "PDF_NOT_FOUND");
        }
        return storageService.load(letter.getPdfPath());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void sendLetterInternal(GeneratedLetter letter, String toEmail, String ccEmail, byte[] pdfBytes) {
        String filename = letter.getType().toLowerCase() + "_" + letter.getEmployeeId() + ".pdf";
        emailService.send(toEmail, ccEmail, letter.getSubject(), letter.getBodyHtmlRendered(), pdfBytes, filename);
        letter.setStatus("SENT");
        letter.setSentAt(Instant.now());
        letter.setSentToEmail(toEmail);
    }

    private LetterTemplate requireTemplate(UUID id) {
        return templateRepo.findActiveById(id)
                .orElseThrow(() -> new HrmsException(
                        "Letter template not found: " + id, HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND"));
    }

    private GeneratedLetter requireLetter(UUID id) {
        return generatedRepo.findActiveById(id)
                .orElseThrow(() -> new HrmsException(
                        "Generated letter not found: " + id, HttpStatus.NOT_FOUND, "LETTER_NOT_FOUND"));
    }
}
