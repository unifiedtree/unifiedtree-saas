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
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

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
    /** Optional: the app's letterhead (logo + company name) for letter PDFs and the email From name. */
    private LetterheadDecorator              letterhead;

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

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setLetterhead(LetterheadDecorator letterhead) {
        this.letterhead = letterhead;
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

        // White label: the PDF opens with the workspace's own letterhead
        // (logo + company name) when the app provides one.
        String companyName = company != null ? company.getName() : null;
        byte[] pdfBytes = pdfRenderer.render(letterhead != null
                ? letterhead.decorate(renderedBody, TenantContext.getTenantId(), companyName)
                : renderedBody);

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
            // B7 FIX (audit 2026-08-15): restrict sendToEmail to the target
            // employee's own email or personalEmail unless the caller holds
            // hrms.letters.send.override. Without this, an HR admin could
            // exfiltrate confidential letters (offer, appraisal, termination)
            // to any address they typed into the "send to" field.
            assertSendToAllowed(toEmail, employee);
            sendLetterInternal(letter, toEmail, null, pdfBytes);
        }

        return toDto(letter, employee);
    }

    @Transactional
    public GeneratedLetterDto sendLetter(UUID letterId, SendLetterRequest req) {
        GeneratedLetter letter = requireLetter(letterId);
        if ("VOID".equals(letter.getStatus())) {
            throw new HrmsException("Cannot send a voided letter", HttpStatus.BAD_REQUEST, "LETTER_VOIDED");
        }
        Employee employee = employeeRepo.findById(letter.getEmployeeId())
                .orElseThrow(() -> new HrmsException("Employee not found", HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND"));
        byte[] pdfBytes = storageService.load(letter.getPdfPath());
        String toEmail  = req.toEmail() != null ? req.toEmail() : employee.getEmail();
        // B7 FIX (audit 2026-08-15): same restriction as sendImmediately.
        assertSendToAllowed(toEmail, employee);
        sendLetterInternal(letter, toEmail, req.ccEmail(), pdfBytes);
        return toDto(generatedRepo.save(letter), employee);
    }

    /**
     * Enforce that {@code toEmail} equals the employee's work email OR
     * their personal_email, unless the caller holds
     * {@code hrms.letters.send.override}. Case-insensitive comparison.
     */
    private static void assertSendToAllowed(String toEmail, Employee employee) {
        if (toEmail == null || employee == null) return;
        String want = toEmail.trim().toLowerCase(java.util.Locale.ROOT);
        String work = employee.getEmail() == null ? null
                : employee.getEmail().trim().toLowerCase(java.util.Locale.ROOT);
        String personal = employee.getPersonalEmail() == null ? null
                : employee.getPersonalEmail().trim().toLowerCase(java.util.Locale.ROOT);
        if (want.equalsIgnoreCase(work) || want.equalsIgnoreCase(personal)) return;
        boolean override = false;
        try {
            var auth = org.springframework.security.core.context.SecurityContextHolder
                    .getContext().getAuthentication();
            override = auth != null && auth.getAuthorities().stream()
                    .anyMatch(g -> "hrms.letters.send.override".equals(g.getAuthority()));
        } catch (Exception ignore) { /* default deny */ }
        if (!override) {
            throw new HrmsException(
                    "Letter can only be sent to the employee's own work or personal email address.",
                    HttpStatus.FORBIDDEN, "LETTER_SEND_TO_FORBIDDEN");
        }
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
        return toDto(generatedRepo.save(letter));
    }

    @Transactional
    public void deleteGeneratedLetter(UUID letterId) {
        GeneratedLetter letter = requireLetter(letterId);
        letter.setDeletedAt(Instant.now());
        generatedRepo.save(letter);
        log.info("Soft-deleted generated letter id={}", letterId);
    }

    @Transactional(readOnly = true)
    public PageResponse<GeneratedLetterDto> listGenerated(Pageable pageable) {
        Page<GeneratedLetter> page = generatedRepo.findAllActive(pageable);
        return toPage(page);
    }

    @Transactional(readOnly = true)
    public GeneratedLetterDto getGenerated(UUID id) {
        return toDto(requireLetter(id));
    }

    @Transactional(readOnly = true)
    public PageResponse<GeneratedLetterDto> getMyLetters(UUID employeeId, Pageable pageable) {
        Page<GeneratedLetter> page = generatedRepo.findActiveByEmployeeId(employeeId, pageable);
        return toPage(page);
    }

    private PageResponse<GeneratedLetterDto> toPage(Page<GeneratedLetter> page) {
        var ids = page.getContent().stream().map(GeneratedLetter::getEmployeeId)
                .filter(Objects::nonNull).distinct().toList();
        Map<UUID, Employee> employees = ids.isEmpty() ? Map.of()
                : employeeRepo.findAllById(ids).stream()
                        .collect(Collectors.toMap(Employee::getId, employee -> employee));
        return PageResponse.from(page, letter -> toDto(letter, employees.get(letter.getEmployeeId())));
    }

    private GeneratedLetterDto toDto(GeneratedLetter letter) {
        return toDto(letter, employeeRepo.findById(letter.getEmployeeId()).orElse(null));
    }

    private GeneratedLetterDto toDto(GeneratedLetter letter, Employee employee) {
        if (employee == null || !Objects.equals(letter.getTenantId(), employee.getTenantId())) {
            return GeneratedLetterDto.from(letter);
        }
        String name = java.util.stream.Stream.of(employee.getFirstName(), employee.getLastName())
                .filter(value -> value != null && !value.isBlank()).collect(Collectors.joining(" "));
        return GeneratedLetterDto.from(letter, name, employee.getEmployeeCode());
    }

    public byte[] getPdf(UUID letterId) {
        GeneratedLetter letter = requireLetter(letterId);
        if (letter.getPdfPath() == null || !storageService.exists(letter.getPdfPath())) {
            throw new HrmsException("PDF not available for letter " + letterId, HttpStatus.NOT_FOUND, "PDF_NOT_FOUND");
        }
        return storageService.load(letter.getPdfPath());
    }

    /**
     * The From name for a letter email: the company's name (white label, never
     * the vendor's), else the workspace name; null lets the mail default apply
     * only when the app provides no letterhead at all.
     */
    public String senderNameFor(UUID companyId) {
        String company = companyId == null ? null
                : companyRepo.findById(companyId).map(Company::getName).orElse(null);
        return letterhead != null ? letterhead.senderName(TenantContext.getTenantId(), company) : company;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void sendLetterInternal(GeneratedLetter letter, String toEmail, String ccEmail, byte[] pdfBytes) {
        String filename = letter.getType().toLowerCase() + "_" + letter.getEmployeeId() + ".pdf";
        emailService.send(toEmail, ccEmail, letter.getSubject(), letter.getBodyHtmlRendered(), pdfBytes, filename,
                senderNameFor(letter.getCompanyId()));
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
