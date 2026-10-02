package com.hrms.letters.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.letters.domain.LetterTemplate;
import com.hrms.letters.dto.*;
import com.hrms.letters.repository.LetterTemplateRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class LetterTemplateService {

    private static final Logger log = LoggerFactory.getLogger(LetterTemplateService.class);

    private final LetterTemplateRepository      templateRepo;
    private final EmployeeRepository            employeeRepo;
    private final WorkforceCompanyRepository    companyRepo;
    private final WorkforceDepartmentRepository departmentRepo;
    private final WorkforceBranchRepository     branchRepo;
    private final MergeFieldResolver            mergeFieldResolver;

    public LetterTemplateService(LetterTemplateRepository templateRepo,
                                 EmployeeRepository employeeRepo,
                                 WorkforceCompanyRepository companyRepo,
                                 WorkforceDepartmentRepository departmentRepo,
                                 WorkforceBranchRepository branchRepo,
                                 MergeFieldResolver mergeFieldResolver) {
        this.templateRepo       = templateRepo;
        this.employeeRepo       = employeeRepo;
        this.companyRepo        = companyRepo;
        this.departmentRepo     = departmentRepo;
        this.branchRepo         = branchRepo;
        this.mergeFieldResolver = mergeFieldResolver;
    }

    @Transactional(readOnly = true)
    public PageResponse<LetterTemplateDto> listTemplates(Pageable pageable) {
        Page<LetterTemplate> page = templateRepo.findAllActive(pageable);
        return PageResponse.from(page, LetterTemplateDto::from);
    }

    @Transactional(readOnly = true)
    public LetterTemplateDto getTemplate(UUID id) {
        return LetterTemplateDto.from(requireTemplate(id));
    }

    @Transactional
    public LetterTemplateDto createTemplate(CreateTemplateRequest req, UUID createdByUserId) {
        LetterTemplate t = new LetterTemplate();
        t.setCompanyId(req.companyId());
        t.setName(req.name());
        t.setType(req.type());
        t.setSubject(req.subject());
        t.setBodyHtml(req.bodyHtml());
        t.setVariantName(req.variantName());
        t.setActive(true);
        log.info("Creating letter template name={} type={}", req.name(), req.type());
        return LetterTemplateDto.from(templateRepo.save(t));
    }

    @Transactional
    public LetterTemplateDto updateTemplate(UUID id, UpdateTemplateRequest req) {
        LetterTemplate t = requireTemplate(id);
        if (req.name()        != null) t.setName(req.name());
        if (req.type()        != null) t.setType(req.type());
        if (req.subject()     != null) t.setSubject(req.subject());
        if (req.bodyHtml()    != null) t.setBodyHtml(req.bodyHtml());
        if (req.active()      != null) t.setActive(req.active());
        if (req.variantName() != null) t.setVariantName(req.variantName());
        return LetterTemplateDto.from(templateRepo.save(t));
    }

    @Transactional
    public void deleteTemplate(UUID id) {
        LetterTemplate t = requireTemplate(id);
        t.setDeletedAt(Instant.now());
        t.setActive(false);
        templateRepo.save(t);
        log.info("Soft-deleted letter template id={}", id);
    }

    public List<MergeFieldEntry> mergeFieldCatalogue() {
        return mergeFieldResolver.catalogue();
    }

    @Transactional(readOnly = true)
    public String previewTemplate(UUID templateId, PreviewTemplateRequest req) {
        LetterTemplate template = requireTemplate(templateId);
        Employee employee = employeeRepo.findById(req.employeeId())
                .orElseThrow(() -> new HrmsException("Employee not found", HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND"));

        Company company = employee.getCompanyId() != null
                ? companyRepo.findById(employee.getCompanyId()).orElse(null) : null;
        Department department = employee.getDepartmentId() != null
                ? departmentRepo.findById(employee.getDepartmentId()).orElse(null) : null;
        Branch branch = employee.getBranchId() != null
                ? branchRepo.findById(employee.getBranchId()).orElse(null) : null;
        Employee manager = employee.getManagerId() != null
                ? employeeRepo.findById(employee.getManagerId()).orElse(null) : null;
        Designation designation = null;
        if (employee.getJobTitle() != null) {
            designation = new Designation();
            designation.setTitle(employee.getJobTitle());
        }

        Map<String, String> ctx = mergeFieldResolver.buildContext(
                employee, company, department, designation, branch, manager,
                req.overrides() != null ? req.overrides() : Map.of());

        return mergeFieldResolver.resolve(template.getBodyHtml(), ctx);
    }

    /**
     * A letter as it would come out, before anything is saved (redesign: the
     * template preview). {@code sample} is true when the merge fields were filled
     * with the catalogue's example values because no employee was given;
     * {@code unresolved} lists the fields that had no value.
     */
    public record RenderedDraft(String subject, String bodyHtml, UUID companyId, String companyName,
                                UUID employeeId, String employeeName, boolean sample, List<String> unresolved) {}

    /**
     * Fill {@code subjectTemplate} and {@code bodyTemplate} for {@code employeeId}
     * (or with the catalogue's examples when null), dated {@code issueDate}
     * (today when null). The company is {@code companyId}'s, else the employee's.
     * Reads only; the caller decides who may see which employee.
     */
    @Transactional(readOnly = true)
    public RenderedDraft renderDraft(String subjectTemplate, String bodyTemplate, UUID companyId, UUID employeeId,
                                     java.time.LocalDate issueDate) {
        String subjectTpl = subjectTemplate == null ? "" : subjectTemplate;
        String bodyTpl = bodyTemplate == null ? "" : bodyTemplate;
        Map<String, String> ctx;
        Employee employee = null;
        Company company = companyId != null ? companyRepo.findById(companyId).orElse(null) : null;
        if (employeeId != null) {
            employee = employeeRepo.findById(employeeId)
                    .orElseThrow(() -> new HrmsException("Employee not found", HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND"));
            if (company == null && employee.getCompanyId() != null) {
                company = companyRepo.findById(employee.getCompanyId()).orElse(null);
            }
            Department department = employee.getDepartmentId() != null
                    ? departmentRepo.findById(employee.getDepartmentId()).orElse(null) : null;
            Branch branch = employee.getBranchId() != null
                    ? branchRepo.findById(employee.getBranchId()).orElse(null) : null;
            Employee manager = employee.getManagerId() != null
                    ? employeeRepo.findById(employee.getManagerId()).orElse(null) : null;
            Designation designation = null;
            if (employee.getJobTitle() != null) {
                designation = new Designation();
                designation.setTitle(employee.getJobTitle());
            }
            ctx = mergeFieldResolver.buildContext(employee, company, department, designation, branch, manager, Map.of(), issueDate);
        } else {
            ctx = mergeFieldResolver.sampleContext(issueDate);
            if (company != null) {
                // The template's own company is known: print its real details, not the examples.
                ctx.put("company.name", company.getName());
                ctx.put("company.legalName", company.getLegalName());
                ctx.put("company.cin", company.getRegistrationNumber());
                ctx.put("company.pan", company.getPanNumber());
                ctx.put("company.gstin", company.getGstin());
                ctx.put("company.signatoryName", null);
                ctx.put("company.signatoryDesignation", null);
            }
        }
        List<String> unresolved = new java.util.ArrayList<>(mergeFieldResolver.unresolvedKeys(subjectTpl, ctx));
        for (String k : mergeFieldResolver.unresolvedKeys(bodyTpl, ctx)) if (!unresolved.contains(k)) unresolved.add(k);
        String employeeName = employee == null ? null
                : java.util.stream.Stream.of(employee.getFirstName(), employee.getLastName())
                        .filter(v -> v != null && !v.isBlank()).collect(java.util.stream.Collectors.joining(" "));
        // The subject is plain text: an unresolved field's red marker is HTML, so it is dropped there.
        return new RenderedDraft(
                mergeFieldResolver.resolve(subjectTpl, ctx).replaceAll("<[^>]*>", ""),
                mergeFieldResolver.resolve(bodyTpl, ctx),
                company != null ? company.getId() : companyId,
                company != null ? company.getName() : null,
                employeeId, employeeName, employee == null, List.copyOf(unresolved));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private LetterTemplate requireTemplate(UUID id) {
        return templateRepo.findActiveById(id)
                .orElseThrow(() -> new HrmsException(
                        "Letter template not found: " + id, HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND"));
    }
}
