package com.hrms.employee.workforce.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceFilter;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import jakarta.persistence.criteria.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Map;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
// List is still referenced by Specification predicate accumulator

/**
 * Workforce directory operations - covers the client's "Workforce Directory"
 * page (Master Data section): list with filters, create, update, exit.
 */
@Service
@Transactional
public class WorkforceEmployeeService {

    private static final Logger log = LoggerFactory.getLogger(WorkforceEmployeeService.class);

    private final WorkforceEmployeeRepository repository;
    private final WorkforceDepartmentRepository departmentRepository;
    private final JdbcTemplate jdbc;
    private final SeatQuotaEnforcer seatQuotaEnforcer;

    public WorkforceEmployeeService(WorkforceEmployeeRepository repository,
                                    WorkforceDepartmentRepository departmentRepository,
                                    JdbcTemplate jdbc,
                                    SeatQuotaEnforcer seatQuotaEnforcer) {
        this.repository = repository;
        this.departmentRepository = departmentRepository;
        this.jdbc = jdbc;
        this.seatQuotaEnforcer = seatQuotaEnforcer;
    }

    // -- Directory query ----------------------------------------------------
    @Transactional(readOnly = true)
    public PageResponse<WorkforceEmployeeResponse> directory(WorkforceFilter f) {
        var spec = buildSpec(f);
        Page<WorkforceEmployee> page = repository.findAll(
                spec,
                PageRequest.of(f.page(), f.pageSize(),
                        Sort.by(Sort.Order.asc("employeeCode"), Sort.Order.asc("firstName"))));
        // PII redaction: list responses MUST NOT include salary (ctcAnnual).
        // The full salary is only exposed on the by-id detail endpoint
        // (WorkforceController.getEmployee), which reuses toResponse().
        return PageResponse.from(page, this::toListResponse);
    }

    private Specification<WorkforceEmployee> buildSpec(WorkforceFilter f) {
        return (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            ps.add(cb.isTrue(root.get("active")));
            if (f.companyId()    != null) ps.add(cb.equal(root.get("companyId"), f.companyId()));
            if (f.departmentId() != null) ps.add(cb.equal(root.get("departmentId"), f.departmentId()));
            if (f.branchId()     != null) ps.add(cb.equal(root.get("branchId"), f.branchId()));
            if (f.status()       != null) ps.add(cb.equal(root.get("employmentStatus"), f.status()));
            if (f.search() != null && !f.search().isBlank()) {
                String needle = "%" + f.search().toLowerCase() + "%";
                ps.add(cb.or(
                        cb.like(cb.lower(root.get("employeeCode")), needle),
                        cb.like(cb.lower(root.get("firstName")),    needle),
                        cb.like(cb.lower(root.get("lastName")),     needle),
                        cb.like(cb.lower(root.get("email")),        needle)
                ));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
    }

    // -- Lookup -------------------------------------------------------------
    @Transactional(readOnly = true)
    public WorkforceEmployeeResponse get(UUID id) {
        return toResponse(repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found")));
    }

    // -- Counts -------------------------------------------------------------
    /**
     * Single grouped-count query for the Workforce Directory stat cards.
     *
     * <p>Replaces the previous SPA behaviour of firing five parallel
     * {@code directory()} calls with {@code pageSize=1} just to read
     * {@code totalElements} — five paginated JPA queries (each doing a
     * COUNT and a SELECT + all mappings) collapsed into one grouped COUNT.
     *
     * <p>Filters on {@code is_active = true} to match {@link #buildSpec}
     * (the directory query hides archived rows) and honours the optional
     * companyId scope. RLS enforces tenant isolation via
     * {@code current_tenant_id()} — no manual tenant filter needed.
     */
    @Transactional(readOnly = true)
    public com.hrms.employee.workforce.dto.WorkforceDtos.EmployeeCountsResponse counts(UUID companyId) {
        String sql = """
                SELECT employment_status, COUNT(*)
                  FROM hrms.employees
                 WHERE is_active = true
                   AND (CAST(? AS uuid) IS NULL OR company_id = CAST(? AS uuid))
              GROUP BY employment_status
                """;
        String cid = companyId == null ? null : companyId.toString();
        long total = 0, active = 0, notice = 0, exited = 0, terminated = 0;
        List<Map<String, Object>> rows = jdbc.queryForList(sql, cid, cid);
        for (Map<String, Object> row : rows) {
            String status = String.valueOf(row.get("employment_status"));
            long n = ((Number) row.get("count")).longValue();
            total += n;
            switch (status) {
                case "ACTIVE"         -> active     = n;
                case "NOTICE_PERIOD"  -> notice     = n;
                case "EXITED"         -> exited     = n;
                case "TERMINATED"     -> terminated = n;
                default               -> { /* PROBATION, SUSPENDED, etc. — counted in total only */ }
            }
        }
        return new com.hrms.employee.workforce.dto.WorkforceDtos.EmployeeCountsResponse(
                total, active, notice, exited, terminated);
    }

    // -- Batch by IDs -------------------------------------------------------
    /**
     * Look up multiple employees in one round trip — used by pages that
     * only need to resolve id → display name for a handful of rows and
     * previously fetched the entire directory page just to build a lookup
     * map. Caps the batch at 500 ids to keep the IN-list bounded.
     */
    @Transactional(readOnly = true)
    public List<WorkforceEmployeeResponse> byIds(List<UUID> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        List<UUID> capped = ids.size() > 500 ? ids.subList(0, 500) : ids;
        // Dedupe to avoid needless DB work when callers pass duplicate ids.
        List<UUID> unique = capped.stream().distinct().toList();
        return repository.findAllById(unique).stream().map(this::toListResponse).toList();
    }

    // -- Create -------------------------------------------------------------
    public WorkforceEmployeeResponse create(CreateWorkforceEmployeeRequest req) {
        // Enforce the workspace's paid seat cap BEFORE we touch the DB.
        // This is the SPA-invoked path (POST /v1/hrms/employees). The
        // previous round guarded this via a Spring AOP aspect that
        // fail-opened on any RuntimeException and never covered the
        // legacy /v1/employees path — replaced with a direct enforcer
        // call inside every create() so both paths share one rule.
        seatQuotaEnforcer.assertCapacity();

        String code = (req.employeeCode() == null || req.employeeCode().isBlank())
                ? generateEmployeeCode(req.companyId())
                : req.employeeCode();

        if (repository.existsByCompanyIdAndEmployeeCode(req.companyId(), code)) {
            throw new BusinessRuleException("Employee code '" + code + "' already in use", "DUPLICATE_EMPLOYEE_CODE");
        }
        if (req.email() != null && !req.email().isBlank()
                && repository.existsByCompanyIdAndEmailIgnoreCase(req.companyId(), req.email())) {
            throw new BusinessRuleException("Email '" + req.email() + "' already in use", "DUPLICATE_EMPLOYEE_EMAIL");
        }

        WorkforceEmployee e = new WorkforceEmployee();
        e.setCompanyId(req.companyId());
        e.setEmployeeCode(code);
        e.setFirstName(req.firstName());
        e.setMiddleName(req.middleName());
        e.setLastName(req.lastName());
        e.setEmail(req.email());
        e.setPhone(req.phone());
        e.setDateOfBirth(req.dateOfBirth());
        e.setGender(req.gender());
        e.setDepartmentId(req.departmentId());
        e.setDesignationId(req.designationId());
        // Anil doc-2 issue 1 (2026-09-01): HR sets a Geofence per employee but
        // rarely sets Branch — the Directory Branch column showed "—" for every
        // row. GeoFenceZone already carries a branch_id (client's model:
        // Branch → Geofence → Employee), so when the caller doesn't supply
        // branchId explicitly but does supply a geofence, we derive branchId
        // from the zone. Explicit branchId (including explicit null on a
        // future edit) always wins so an admin can override.
        e.setGeoFenceZoneId(req.geoFenceZoneId());
        UUID resolvedBranchId = req.branchId() != null
                ? req.branchId()
                : deriveBranchFromGeofence(req.geoFenceZoneId());
        e.setBranchId(resolvedBranchId);
        // Weekly off days CSV (ISO 1=Mon..7=Sun). Default Sat+Sun when unset.
        e.setWeeklyOffDays((req.weeklyOffDays() == null || req.weeklyOffDays().isBlank())
                ? "6,7" : req.weeklyOffDays().trim());
        // Reporting manager: explicit value wins; otherwise auto-derive from the
        // selected department's head. The client no longer ships a chip picker;
        // the rule "you report to the head of your department" is canonical.
        e.setReportingManagerId(resolveReportingManager(req.reportingManagerId(), req.departmentId()));
        e.setEmploymentType(req.employmentType() != null
                ? req.employmentType() : WorkforceEmployee.EmploymentType.FULL_TIME);
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.PROBATION);
        e.setDateOfJoining(req.dateOfJoining());
        e.setCtcAnnual(req.ctcAnnual());

        e.setPanNumber(req.panNumber());
        e.setAadhaarNumber(req.aadhaarNumber());
        e.setPassportNumber(req.passportNumber());
        // B2 FIX (audit 2026-08-15): persist statutory + salary fields that
        // previously fell through unread.
        e.setPfUan(req.uan());
        e.setEsiNumber(req.esi());
        e.setMonthlySalary(req.monthlySalary());
        e.setSalaryFrequency(req.salaryFrequency());

        e.setBankName(req.bankName());
        e.setBankAccountNumber(req.bankAccountNumber());
        e.setBankIfsc(req.bankIfsc());

        e.setCurrentAddressLine(req.currentAddressLine());
        e.setCurrentAddressCity(req.currentAddressCity());
        e.setCurrentAddressState(req.currentAddressState());
        e.setCurrentAddressPincode(req.currentAddressPincode());

        e.setEmergencyContactName(req.emergencyContactName());
        e.setEmergencyContactRelation(req.emergencyContactRelation());
        e.setEmergencyContactPhone(req.emergencyContactPhone());

        e.setActive(true);
        return toResponse(repository.save(e));
    }

    // -- Update -------------------------------------------------------------
    public WorkforceEmployeeResponse update(UUID id, UpdateWorkforceEmployeeRequest req) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));

        if (req.firstName()        != null) e.setFirstName(req.firstName());
        if (req.middleName()       != null) e.setMiddleName(req.middleName());
        if (req.lastName()         != null) e.setLastName(req.lastName());
        if (req.email()            != null) e.setEmail(req.email());
        if (req.phone()            != null) e.setPhone(req.phone());
        if (req.dateOfBirth()      != null) e.setDateOfBirth(req.dateOfBirth());
        if (req.gender()           != null) e.setGender(req.gender());
        if (req.departmentId()     != null) e.setDepartmentId(req.departmentId());
        if (req.designationId()    != null) e.setDesignationId(req.designationId());
        // Branch / geofence: process together so that assigning a geofence
        // without also picking a branch back-fills the branch from the zone
        // (same rule as create()). See Anil doc-2 issue 1.
        if (req.branchId()         != null) e.setBranchId(req.branchId());
        if (req.geoFenceZoneId()   != null) {
            e.setGeoFenceZoneId(req.geoFenceZoneId());
            if (req.branchId() == null && e.getBranchId() == null) {
                UUID derived = deriveBranchFromGeofence(req.geoFenceZoneId());
                if (derived != null) e.setBranchId(derived);
            }
        }
        if (req.reportingManagerId() != null) e.setReportingManagerId(req.reportingManagerId());
        if (req.employmentType()   != null) e.setEmploymentType(req.employmentType());
        if (req.employmentStatus() != null) e.setEmploymentStatus(req.employmentStatus());
        if (req.dateOfJoining()    != null) e.setDateOfJoining(req.dateOfJoining());
        if (req.probationEndDate() != null) e.setProbationEndDate(req.probationEndDate());
        if (req.confirmationDate() != null) e.setConfirmationDate(req.confirmationDate());
        if (req.noticeStartDate()  != null) e.setNoticeStartDate(req.noticeStartDate());
        if (req.lastWorkingDay()   != null) e.setLastWorkingDay(req.lastWorkingDay());
        if (req.exitReason()       != null) e.setExitReason(req.exitReason());
        if (req.ctcAnnual()        != null) e.setCtcAnnual(req.ctcAnnual());
        if (req.profilePhotoUrl()  != null) e.setProfilePhotoUrl(req.profilePhotoUrl());
        // B2 FIX (audit 2026-08-15): apply the seven fields the update form
        // has always shipped but the service silently dropped — bank + tax +
        // salary + weekly-off. Every "Saved" toast for these has been a lie.
        if (req.uan()              != null) e.setPfUan(req.uan());
        if (req.esi()              != null) e.setEsiNumber(req.esi());
        if (req.bankAccountNumber()!= null) e.setBankAccountNumber(req.bankAccountNumber());
        if (req.bankIfsc()         != null) e.setBankIfsc(req.bankIfsc());
        if (req.monthlySalary()    != null) e.setMonthlySalary(req.monthlySalary());
        if (req.salaryFrequency()  != null) e.setSalaryFrequency(req.salaryFrequency());
        if (req.weeklyOffDays()    != null) e.setWeeklyOffDays(req.weeklyOffDays().trim());

        return toResponse(repository.save(e));
    }

    // -- Confirm / Probation end --------------------------------------------
    public WorkforceEmployeeResponse confirm(UUID id, java.time.LocalDate confirmationDate) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.ACTIVE);
        e.setConfirmationDate(confirmationDate);
        return toResponse(repository.save(e));
    }

    // -- Start notice -------------------------------------------------------
    public WorkforceEmployeeResponse startNotice(UUID id, java.time.LocalDate noticeStart, java.time.LocalDate lastWorkingDay, String reason) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.NOTICE_PERIOD);
        e.setNoticeStartDate(noticeStart);
        e.setLastWorkingDay(lastWorkingDay);
        e.setExitReason(reason);
        return toResponse(repository.save(e));
    }

    // -- Exit ---------------------------------------------------------------
    public WorkforceEmployeeResponse exit(UUID id, java.time.LocalDate lastWorkingDay, String reason) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.EXITED);
        e.setLastWorkingDay(lastWorkingDay);
        e.setExitReason(reason);
        return toResponse(repository.save(e));
    }

    // -- Cancel notice (withdraw resignation, revert to active) -------------
    public WorkforceEmployeeResponse cancelNotice(UUID id) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        if (e.getEmploymentStatus() != WorkforceEmployee.EmploymentStatus.NOTICE_PERIOD) {
            throw new BusinessRuleException("Only an employee on notice period can have their notice cancelled",
                    "NOT_ON_NOTICE");
        }
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.ACTIVE);
        e.setNoticeStartDate(null);
        e.setLastWorkingDay(null);
        e.setExitReason(null);
        return toResponse(repository.save(e));
    }

    // -- Resolve reporting manager from department head ---------------------
    // Returns the explicit value if provided; otherwise looks up the
    // selected department's head. Falls back to null when the department has
    // no head set (e.g. first ever employee in a brand-new workspace) — the
    // controller layer can layer-on additional fallbacks like "report to admin"
    // by passing reportingManagerId in the request.
    private UUID resolveReportingManager(UUID explicit, UUID departmentId) {
        if (explicit != null) return explicit;
        if (departmentId == null) return null;
        return departmentRepository.findById(departmentId)
                .map(Department::getDepartmentHeadEmployeeId)
                .orElse(null);
    }

    // -- Generator: per-company auto-increment (V082) -----------------------
    // Reads the tenant/company's configured prefix + next number + padding
    // from settings.hr_configuration and atomically increments the counter.
    // Runs inside the surrounding @Transactional so a downstream failure in
    // create() rolls back the counter bump too — no gaps under load.
    private String generateEmployeeCode(UUID companyId) {
        Map<String, Object> row = incrementAndFetch(companyId);
        if (row == null) {
            // No config row yet for this company — seed one with defaults, then
            // atomically increment on the SAME row. INSERT is idempotent via
            // the (tenant_id, company_id) unique constraint.
            jdbc.update("""
                INSERT INTO settings.hr_configuration (id, tenant_id, company_id)
                VALUES (gen_random_uuid(), current_tenant_id(), ?)
                ON CONFLICT (tenant_id, company_id) DO NOTHING
                """, companyId);
            row = incrementAndFetch(companyId);
        }
        if (row == null) {
            throw new BusinessRuleException(
                    "Could not issue employee code — HR configuration missing for company " + companyId,
                    "EMPLOYEE_CODE_CONFIG_MISSING");
        }
        String prefix = (String) row.get("prefix");
        long issued   = ((Number) row.get("issued")).longValue();
        int padding   = ((Number) row.get("padding")).intValue();
        return prefix + "-" + String.format(Locale.ROOT, "%0" + padding + "d", issued);
    }

    private Map<String, Object> incrementAndFetch(UUID companyId) {
        try {
            // First, resync the counter to MAX(counter, actual_highest_in_use + 1).
            // This handles three real-world cases where the counter would
            // otherwise drift behind reality:
            //   1. Excel/CSV bulk import that inserted codes past the counter
            //   2. An admin who manually typed a code like SRC-500 as an override
            //   3. Prefix change mid-way that landed on an already-used numeric range
            // We look at ALL employees in this company whose code matches the
            // configured prefix + one-or-more digits, extract the trailing
            // number, and bump the counter if MAX(that number) + 1 is higher
            // than what the counter currently holds. Then increment as usual.
            jdbc.update("""
                UPDATE settings.hr_configuration cfg
                   SET employee_code_next_number = GREATEST(
                     cfg.employee_code_next_number,
                     COALESCE((
                       SELECT MAX((regexp_replace(e.employee_code, '^' || cfg.employee_code_prefix || '-', ''))::bigint)
                         FROM hrms.employees e
                        WHERE e.company_id = cfg.company_id
                          AND e.employee_code ~ ('^' || cfg.employee_code_prefix || '-[0-9]+$')
                     ), 0) + 1
                   )
                 WHERE cfg.company_id = ?
                """, companyId);
            return jdbc.queryForMap("""
                UPDATE settings.hr_configuration
                   SET employee_code_next_number = employee_code_next_number + 1
                 WHERE company_id = ?
                 RETURNING employee_code_prefix          AS prefix,
                          employee_code_next_number - 1 AS issued,
                          employee_code_padding         AS padding
                """, companyId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    // -- Mapping ------------------------------------------------------------
    private WorkforceEmployeeResponse toResponse(WorkforceEmployee e) {
        // B2 FIX (audit 2026-08-15): expose bank/tax/salary fields in the
        // detail response, but MASK the bank account to last-4 unless the
        // caller holds hrms.employees.pii.read. Salary + PAN/Aadhaar remain
        // fully redacted from this generic response — HR/finance code paths
        // should call the elevated /identity or /bank endpoints (follow-up).
        boolean piiRead = hasAuthority("hrms.employees.pii.read");
        String bankAcct = piiRead
                ? e.getBankAccountNumber()
                : maskLast4(e.getBankAccountNumber());
        BigDecimal monthlySalary = piiRead ? e.getMonthlySalary() : null;
        BigDecimal ctc          = piiRead ? e.getCtcAnnual()     : null;
        return new WorkforceEmployeeResponse(
                e.getId(), e.getCompanyId(), e.getEmployeeCode(),
                e.getFirstName(), e.getMiddleName(), e.getLastName(),
                e.getEmail(), e.getPhone(), e.getDateOfBirth(), e.getGender(),
                e.getDepartmentId(), e.getDesignationId(), e.getBranchId(),
                e.getGeoFenceZoneId(),
                e.getReportingManagerId(),
                e.getEmploymentType(), e.getEmploymentStatus(),
                e.getDateOfJoining(), e.getProbationEndDate(),
                e.getConfirmationDate(), e.getLastWorkingDay(),
                ctc,
                e.getPfUan(), e.getEsiNumber(),
                bankAcct, e.getBankIfsc(),
                monthlySalary, e.getSalaryFrequency(),
                parseWeeklyOffDays(e.getWeeklyOffDays()),
                e.getProfilePhotoUrl(),
                e.isFaceEnrolled(), checkHasAccount(e.getId()), e.isActive());
    }

    /**
     * Parse the CSV weekly-off column ("6,7") into a List of ISO day numbers
     * (1=Mon..7=Sun). Frontend edit mode hydrates checkboxes from this list;
     * returning null/empty makes the form default to Sat+Sun.
     *
     * <p>Tolerant of whitespace and out-of-range values (silently dropped) so
     * a legacy row can't 500 the response. Duplicates are preserved — the
     * frontend already de-dups when building the checkbox state.
     */
    private static java.util.List<Integer> parseWeeklyOffDays(String csv) {
        if (csv == null || csv.isBlank()) return java.util.List.of();
        String[] parts = csv.split(",");
        java.util.List<Integer> out = new java.util.ArrayList<>(parts.length);
        for (String p : parts) {
            String t = p.trim();
            if (t.isEmpty()) continue;
            try {
                int d = Integer.parseInt(t);
                if (d >= 1 && d <= 7) out.add(d);
            } catch (NumberFormatException ignore) { /* skip malformed */ }
        }
        return out;
    }

    /** Mask a bank account number to "****1234" — first N-4 chars replaced. */
    private static String maskLast4(String acct) {
        if (acct == null || acct.isBlank()) return null;
        String t = acct.trim();
        if (t.length() <= 4) return "****";
        return "****" + t.substring(t.length() - 4);
    }

    /** True if the current Spring Security Authentication has the given authority. */
    private static boolean hasAuthority(String authority) {
        try {
            var auth = org.springframework.security.core.context.SecurityContextHolder
                    .getContext().getAuthentication();
            if (auth == null) return false;
            return auth.getAuthorities().stream()
                    .anyMatch(a -> authority.equals(a.getAuthority()));
        } catch (Exception ignore) {
            return false;
        }
    }

    /**
     * List-safe variant of {@link #toResponse}. Salary (ctcAnnual) is blanked
     * to null so the workforce directory can't be scraped for every
     * employee's compensation by anyone with hrms.employee.read. Full salary
     * is still available on the by-id detail endpoint.
     *
     * The DTO shape stays the same (single WorkforceEmployeeResponse record)
     * to avoid churning the WorkforceController + frontend contract; the
     * sensitive field is simply omitted from the payload as null.
     */
    private WorkforceEmployeeResponse toListResponse(WorkforceEmployee e) {
        // B2 FIX (audit 2026-08-15): list responses redact ALL PII (bank,
        // salary, tax) — only the elevated by-id endpoint returns them
        // (masked bank unless caller has hrms.employees.pii.read).
        return new WorkforceEmployeeResponse(
                e.getId(), e.getCompanyId(), e.getEmployeeCode(),
                e.getFirstName(), e.getMiddleName(), e.getLastName(),
                e.getEmail(), e.getPhone(), e.getDateOfBirth(), e.getGender(),
                e.getDepartmentId(), e.getDesignationId(), e.getBranchId(),
                e.getGeoFenceZoneId(),
                e.getReportingManagerId(),
                e.getEmploymentType(), e.getEmploymentStatus(),
                e.getDateOfJoining(), e.getProbationEndDate(),
                e.getConfirmationDate(), e.getLastWorkingDay(),
                null /* ctcAnnual — redacted in list responses */,
                null /* uan */, null /* esi */,
                null /* bankAcct */, null /* bankIfsc */,
                null /* monthlySalary */, null /* salaryFrequency */,
                parseWeeklyOffDays(e.getWeeklyOffDays()),
                e.getProfilePhotoUrl(),
                e.isFaceEnrolled(), checkHasAccount(e.getId()), e.isActive());
    }

    /**
     * Look up a geofence's parent branch_id via a single JDBC query. Returns
     * null if the zone id is null, doesn't exist, or the zone has no branch
     * attached. RLS on attendance.geo_fence_zones already scopes this to the
     * caller's tenant. Kept in the service (rather than adding a hrms-attendance
     * repository dependency) to avoid a cross-module JPA import for one column.
     */
    private UUID deriveBranchFromGeofence(UUID zoneId) {
        if (zoneId == null) return null;
        try {
            // Schema is public.geo_fence_zones (@Table on GeoFenceZone), NOT
            // attendance.* — verified against prod DB 2026-09-01.
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT branch_id FROM public.geo_fence_zones WHERE id = ?",
                    zoneId);
            if (rows.isEmpty()) return null;
            Object v = rows.get(0).get("branch_id");
            return v == null ? null : (UUID) v;
        } catch (Exception ex) {
            log.warn("branch-derive from geofence {} failed: {}", zoneId, ex.getMessage());
            return null;
        }
    }

    private boolean checkHasAccount(UUID employeeId) {
        try {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM auth.user_credentials WHERE employee_id = ? AND is_active = true",
                    Integer.class, employeeId);
            return count != null && count > 0;
        } catch (Exception ex) {
            log.warn("hasAccount check failed for employee {}: {}", employeeId, ex.getMessage());
            return false;
        }
    }
}
