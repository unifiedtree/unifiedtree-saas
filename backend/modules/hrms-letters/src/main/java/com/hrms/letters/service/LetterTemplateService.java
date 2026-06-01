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

    // ── helpers ──────────────────────────────────────────────────────────────

    private LetterTemplate requireTemplate(UUID id) {
        return templateRepo.findActiveById(id)
                .orElseThrow(() -> new HrmsException(
                        "Letter template not found: " + id, HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND"));
    }
}
