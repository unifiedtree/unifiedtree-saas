package com.hrms.employee.workforce.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchHit;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
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
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
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
    private final NamedParameterJdbcTemplate namedJdbc;
    private final SeatQuotaEnforcer seatQuotaEnforcer;

    public WorkforceEmployeeService(WorkforceEmployeeRepository repository,
                                    WorkforceDepartmentRepository departmentRepository,
                                    JdbcTemplate jdbc,
                                    SeatQuotaEnforcer seatQuotaEnforcer) {
        this.repository = repository;
        this.departmentRepository = departmentRepository;
        this.jdbc = jdbc;
        this.namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        this.seatQuotaEnforcer = seatQuotaEnforcer;
    }

    // -- Directory query ----------------------------------------------------
    @Transactional(readOnly = true)
    public PageResponse<WorkforceEmployeeResponse> directory(WorkforceFilter f) {
        // Milestone filters pick their people with the dashboard card's own SQL
        // (MilestoneWindow), once, before the paged query.
        List<UUID> milestoneIds = f.milestone() == null ? null
                : jdbc.queryForList(MilestoneWindow.idsSql(f.milestone()), UUID.class, f.milestone().clamp(f.milestoneWithin()));
        var spec = buildSpec(f, milestoneIds);
        Page<WorkforceEmployee> page = repository.findAll(
                spec,
                PageRequest.of(f.page(), f.pageSize(),
                        Sort.by(Sort.Order.asc("employeeCode"), Sort.Order.asc("firstName"))));
        // PII redaction: list responses MUST NOT include salary (ctcAnnual).
        // The full salary is only exposed on the by-id detail endpoint
        // (WorkforceController.getEmployee), which reuses toResponse().
        return PageResponse.from(page, this::toListResponse);
    }

    private Specification<WorkforceEmployee> buildSpec(WorkforceFilter f, List<UUID> milestoneIds) {
        return (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            ps.add(cb.isTrue(root.get("active")));
            if (f.companyId()    != null) ps.add(cb.equal(root.get("companyId"), f.companyId()));
            if (f.departmentId() != null) ps.add(cb.equal(root.get("departmentId"), f.departmentId()));
            if (f.noDepartment())         ps.add(cb.isNull(root.get("departmentId")));
            if (milestoneIds != null)     ps.add(milestoneIds.isEmpty() ? cb.disjunction() : root.get("id").in(milestoneIds));
            if (f.branchId()     != null) ps.add(cb.equal(root.get("branchId"), f.branchId()));
            if (f.status()       != null) ps.add(cb.equal(root.get("employmentStatus"), f.status()));
            if (f.search() != null && !f.search().isBlank()) {
                String needle = "%" + f.search().trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT) + "%";
                var firstName = cb.trim(cb.coalesce(root.<String>get("firstName"), ""));
                var middleName = cb.trim(cb.coalesce(root.<String>get("middleName"), ""));
                var lastName = cb.trim(cb.coalesce(root.<String>get("lastName"), ""));
                var firstAndLast = cb.concat(cb.concat(firstName, " "), lastName);
                var fullName = cb.concat(cb.concat(cb.concat(firstName, " "), middleName), cb.concat(" ", lastName));
                ps.add(cb.or(
                        cb.like(cb.lower(root.get("employeeCode")), needle),
                        cb.like(cb.lower(root.get("firstName")),    needle),
                        cb.like(cb.lower(root.get("middleName")),   needle),
                        cb.like(cb.lower(root.get("lastName")),     needle),
                        cb.like(cb.lower(root.get("email")),        needle),
                        cb.like(cb.lower(firstAndLast), needle),
                        cb.like(cb.lower(fullName), needle)
                ));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
    }

    // -- Entity search (GET /v1/search) -------------------------------------
    //
    // Milestone 4C. Same visibility rule as directory(): active rows only,
    // tenant isolation by RLS (TenantAwareDataSource sets app.tenant_id on the
    // leased connection, so this JDBC statement is fenced exactly like the JPA
    // one above), and the permission gate lives on the controller, where it is
    // the same hasAuthority('hrms.employee.read') the directory uses. There is
    // no manager/department scope here because the directory has none: a
    // DEPT_MANAGER with hrms.employee.read already sees the whole tenant on
    // /v1/hrms/employees, and search must not be looser OR tighter than that.
    //
    // Why native SQL rather than a second Specification: the result has to be
    // ranked (exact -> prefix -> substring) and joined to department/designation
    // names, and doing that in one parameterised statement with a LIMIT is
    // both the cheapest and the easiest to read in an EXPLAIN. The lookup
    // tables are RLS-fenced too, so the LEFT JOINs cannot surface another
    // tenant's names. pg_trgm / full-text were deliberately not introduced.

    public static final int SEARCH_MIN_QUERY_CHARS = 2;
    public static final int SEARCH_DEFAULT_LIMIT   = 8;
    public static final int SEARCH_MAX_LIMIT       = 20;
    /** Longer than any name/code/email column; anything past this is noise. */
    private static final int SEARCH_MAX_QUERY_CHARS = 100;

    /** At most this many words of a query are matched separately (the rest is noise). */
    static final int SEARCH_MAX_TOKENS = 4;

    private static final String SEARCH_SELECT = """
        SELECT e.id, e.first_name, e.last_name, e.employee_code, e.profile_photo_url,
               d.name  AS department_name,
               g.title AS job_title
        FROM hrms.employees e
        LEFT JOIN hrms.departments  d ON d.id = e.department_id
        LEFT JOIN hrms.designations g ON g.id = e.designation_id
        WHERE e.is_active = TRUE
        """;

    /** The whole query somewhere in a name, the full name, the code or the email. */
    private static final String SEARCH_WHOLE = """
              lower(e.employee_code) LIKE :contains ESCAPE '\\'
           OR lower(e.first_name)    LIKE :contains ESCAPE '\\'
           OR lower(e.last_name)     LIKE :contains ESCAPE '\\'
           OR lower(concat_ws(' ', e.first_name, e.last_name)) LIKE :contains ESCAPE '\\'
           OR lower(e.email)         LIKE :contains ESCAPE '\\'""";

    private static final String SEARCH_ORDER = """
        ORDER BY
          CASE
            WHEN lower(e.employee_code) = :exact
              OR lower(e.first_name)    = :exact
              OR lower(e.last_name)     = :exact
              OR lower(concat_ws(' ', e.first_name, e.last_name)) = :exact
              OR lower(e.email)         = :exact THEN 0
            WHEN lower(e.employee_code) LIKE :prefix ESCAPE '\\'
              OR lower(e.first_name)    LIKE :prefix ESCAPE '\\'
              OR lower(e.last_name)     LIKE :prefix ESCAPE '\\'
              OR lower(concat_ws(' ', e.first_name, e.last_name)) LIKE :prefix ESCAPE '\\'
              OR lower(e.email)         LIKE :prefix ESCAPE '\\' THEN 1
            WHEN %s THEN 2
            ELSE 3
          END,
          e.employee_code, e.id
        LIMIT :limit
        """;

    /**
     * The words of a normalised query, first {@value #SEARCH_MAX_TOKENS} distinct ones.
     * "rahul verma" → [rahul, verma]; a one-word query gives one token.
     */
    public static List<String> searchTokens(String normalized) {
        if (normalized == null || normalized.isBlank()) return List.of();
        return java.util.Arrays.stream(normalized.trim().split(" "))
                .filter(s -> !s.isBlank()).distinct().limit(SEARCH_MAX_TOKENS).toList();
    }

    /**
     * The search statement for {@code tokenCount} words. A row matches when the
     * whole query appears in a name, code or email (as before), or when EVERY
     * word appears in one of the name, code, email, department or designation
     * (so "rah ver" finds Rahul Verma and "sales priya" finds Priya in Sales).
     * Ranking: exact, then prefix, then the whole query inside a name, code or
     * email, then word-by-word matches. Only named parameters are concatenated
     * (:t0 … :t3), never user text.
     */
    public static String searchSql(int tokenCount) {
        int n = Math.max(0, Math.min(tokenCount, SEARCH_MAX_TOKENS));
        StringBuilder words = new StringBuilder();
        for (int i = 0; i < n; i++) {
            String p = ":t" + i;
            words.append(i == 0 ? "" : " AND ")
                 .append("(lower(e.employee_code) LIKE ").append(p).append(" ESCAPE '\\'")
                 .append(" OR lower(e.first_name) LIKE ").append(p).append(" ESCAPE '\\'")
                 .append(" OR lower(e.last_name) LIKE ").append(p).append(" ESCAPE '\\'")
                 .append(" OR lower(e.email) LIKE ").append(p).append(" ESCAPE '\\'")
                 .append(" OR lower(coalesce(d.name, '')) LIKE ").append(p).append(" ESCAPE '\\'")
                 .append(" OR lower(coalesce(g.title, '')) LIKE ").append(p).append(" ESCAPE '\\')");
        }
        String whole = "(" + SEARCH_WHOLE + ")";
        String where = n == 0 ? whole : "(" + whole + " OR (" + words + "))";
        return SEARCH_SELECT + "  AND " + where + "\n" + SEARCH_ORDER.formatted(whole);
    }

    /**
     * Typeahead over first name, last name, full name, employee code and work
     * email, and word by word over those plus department and designation (see
     * {@link #searchSql}). Case-insensitive; exact matches rank first, then
     * prefix, then substring, then word-by-word; ties break on employee code
     * so the order is stable between keystrokes.
     *
     * @param rawQuery user text; must normalise to at least
     *                 {@link #SEARCH_MIN_QUERY_CHARS} characters (the
     *                 controller has already rejected shorter input with 400,
     *                 this is the defence-in-depth check).
     * @param requestedLimit clamped into [1, {@link #SEARCH_MAX_LIMIT}].
     */
    @Transactional(readOnly = true)
    public EmployeeSearchResponse search(String rawQuery, int requestedLimit) {
        String q = normalizeSearchQuery(rawQuery);
        if (q.length() < SEARCH_MIN_QUERY_CHARS) {
            throw new IllegalArgumentException(
                    "search query must be at least " + SEARCH_MIN_QUERY_CHARS + " characters");
        }
        int limit = Math.max(1, Math.min(requestedLimit, SEARCH_MAX_LIMIT));
        String escaped = escapeLike(q);

        List<String> tokens = searchTokens(q);
        var params = new MapSqlParameterSource()
                .addValue("exact",    q)
                .addValue("prefix",   escaped + "%")
                .addValue("contains", "%" + escaped + "%")
                // Fetch one past the page so the client can say "narrow your
                // search" without a second COUNT(*) round-trip.
                .addValue("limit",    limit + 1);
        for (int i = 0; i < tokens.size(); i++) params.addValue("t" + i, "%" + escapeLike(tokens.get(i)) + "%");

        List<EmployeeSearchHit> rows = namedJdbc.query(searchSql(tokens.size()), params, (rs, i) -> new EmployeeSearchHit(
                rs.getObject("id", UUID.class),
                displayName(rs.getString("first_name"), rs.getString("last_name")),
                rs.getString("employee_code"),
                rs.getString("department_name"),
                rs.getString("job_title"),
                rs.getString("profile_photo_url")));

        boolean truncated = rows.size() > limit;
        return new EmployeeSearchResponse(truncated ? rows.subList(0, limit) : rows, limit, truncated);
    }

    /** Trim, collapse runs of whitespace, lower-case, cap length. */
    public static String normalizeSearchQuery(String raw) {
        if (raw == null) return "";
        String q = raw.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        return q.length() > SEARCH_MAX_QUERY_CHARS ? q.substring(0, SEARCH_MAX_QUERY_CHARS) : q;
    }

    /**
     * LIKE metacharacters typed by the user are matched literally. Without this
     * "%" alone would match every employee and "_" would act as a wildcard: not
     * a data leak (RLS still applies) but a bogus result set. The directory's
     * own search has the same latent quirk; it is not changed here.
     */
    static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static String displayName(String first, String last) {
        String f = first == null ? "" : first.trim();
        String l = last  == null ? "" : last.trim();
        return (f + " " + l).trim();
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
        // Designation: explicit id wins. When the tenant has no designations
        // configured the web form falls back to a free-text input and sends
        // `designation` — before 2026-09-08 that value had no DTO field and was
        // silently dropped, so the new hire ended up with no designation at all.
        // Now we resolve-or-create so the typed title is preserved AND becomes
        // reusable for the next hire.
        e.setDesignationId(req.designationId() != null
                ? req.designationId()
                : resolveOrCreateDesignation(req.companyId(), req.designation()));
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
        // Anil Branch.docx (2026-09-10): the Directory still showed "—" under
        // Branch for most people, with a Branch filter above it that could
        // never match them. The zone-derivation above only fires when HR picks
        // a Punch Zone, and that field is explicitly optional ("leave
        // unselected to allow company-wide punch-in") — so the common path set
        // no branch at all. The Add Employee wizard deliberately has no Branch
        // field, because it mirrors the mobile Add Staff form field for field.
        // When the company has exactly ONE active branch there is no ambiguity
        // about where a new hire sits, so default to it. Multi-branch tenants
        // are left null rather than guessed at; HR sets it on the profile.
        if (resolvedBranchId == null) resolvedBranchId = soleActiveBranchOf(req.companyId());
        e.setBranchId(resolvedBranchId);
        // Weekly off days CSV (ISO 1=Mon..7=Sun). When unset, start from the
        // company's weekly off days (HR Configuration), else Sat+Sun.
        e.setWeeklyOffDays((req.weeklyOffDays() == null || req.weeklyOffDays().isBlank())
                ? companyOffDaysCsv(req.companyId()) : req.weeklyOffDays().trim());
        // Reporting manager: explicit value wins; otherwise auto-derive from the
        // selected department's head. The client no longer ships a chip picker;
        // the rule "you report to the head of your department" is canonical.
        e.setReportingManagerId(resolveReportingManager(req.reportingManagerId(), req.departmentId()));
        e.setEmploymentType(req.employmentType() != null
                ? req.employmentType() : WorkforceEmployee.EmploymentType.FULL_TIME);
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.PROBATION);
        e.setDateOfJoining(req.dateOfJoining());
        // Default probation (HR Configuration → Probation → Default probation):
        // the end date is the joining date plus the company's months. 0 months
        // means new hires start confirmed, without probation.
        applyDefaultProbation(e, companyProbationMonths(req.companyId()));
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
        // 2026-09-08: bank_branch_name column existed but was never mapped.
        e.setBankBranchName(req.bankBranchName());

        e.setCurrentAddressLine(req.currentAddressLine());
        e.setCurrentAddressCity(req.currentAddressCity());
        e.setCurrentAddressState(req.currentAddressState());
        e.setCurrentAddressPincode(req.currentAddressPincode());

        e.setEmergencyContactName(req.emergencyContactName());
        e.setEmergencyContactRelation(req.emergencyContactRelation());
        e.setEmergencyContactPhone(req.emergencyContactPhone());

        e.setActive(true);
        // Flush now: callers in the same transaction (the Users & access invite)
        // read the new row with plain JDBC, which never triggers a JPA flush.
        WorkforceEmployee saved = repository.saveAndFlush(e);
        syncJobTitle(saved.getId());
        return toResponse(saved);
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
        if (req.exitType()         != null) e.setExitType(req.exitType());
        if (req.ctcAnnual()        != null) e.setCtcAnnual(req.ctcAnnual());
        if (req.profilePhotoUrl()  != null) e.setProfilePhotoUrl(req.profilePhotoUrl());
        // B2 FIX (audit 2026-08-15): apply the seven fields the update form
        // has always shipped but the service silently dropped — bank + tax +
        // salary + weekly-off. Every "Saved" toast for these has been a lie.
        if (req.uan()              != null) e.setPfUan(req.uan());
        if (req.esi()              != null) e.setEsiNumber(req.esi());
        if (req.bankAccountNumber()!= null) e.setBankAccountNumber(req.bankAccountNumber());
        if (req.bankIfsc()         != null) e.setBankIfsc(req.bankIfsc());
        if (req.bankBranchName()   != null) e.setBankBranchName(req.bankBranchName());
        // 2026-09-08 audit: create() persisted these three, update() ignored
        // them — an HR correction to a mistyped PAN could never be saved.
        if (req.panNumber()        != null) e.setPanNumber(req.panNumber());
        if (req.aadhaarNumber()    != null) e.setAadhaarNumber(req.aadhaarNumber());
        if (req.bankName()         != null) e.setBankName(req.bankName());
        if (req.monthlySalary()    != null) e.setMonthlySalary(req.monthlySalary());
        if (req.salaryFrequency()  != null) e.setSalaryFrequency(req.salaryFrequency());
        if (req.weeklyOffDays()    != null) e.setWeeklyOffDays(req.weeklyOffDays().trim());

        WorkforceEmployee saved = repository.saveAndFlush(e);
        if (req.designationId() != null) syncJobTitle(saved.getId());
        return toResponse(saved);
    }

    /**
     * hrms.employees.job_title is not mapped on WorkforceEmployee, but the
     * attendance staff lists, the ESS home, employee search and letter
     * {{employee.designation}} all read it. Keep it equal to the designation's
     * title so an employee made or edited here never shows a blank role.
     */
    private void syncJobTitle(UUID employeeId) {
        jdbc.update("""
            UPDATE hrms.employees e
               SET job_title = d.title
              FROM hrms.designations d
             WHERE e.id = ? AND d.id = e.designation_id
               AND e.job_title IS DISTINCT FROM d.title
            """, employeeId);
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
        return startNotice(id, noticeStart, lastWorkingDay, reason, null);
    }

    /** V143.13: the notice also records why the person is leaving (null keeps what is recorded). */
    public WorkforceEmployeeResponse startNotice(UUID id, java.time.LocalDate noticeStart, java.time.LocalDate lastWorkingDay,
                                                 String reason, WorkforceEmployee.ExitType exitType) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.NOTICE_PERIOD);
        e.setNoticeStartDate(noticeStart);
        e.setLastWorkingDay(lastWorkingDay);
        e.setExitReason(reason);
        if (exitType != null) e.setExitType(exitType);
        return toResponse(repository.save(e));
    }

    // -- Exit ---------------------------------------------------------------
    public WorkforceEmployeeResponse exit(UUID id, java.time.LocalDate lastWorkingDay, String reason) {
        return exit(id, lastWorkingDay, reason, null);
    }

    /**
     * V143.13: mark exited with the exit type. A null type keeps the one recorded
     * when the notice started; the status stays EXITED for every type (the
     * attrition report splits on the type, not the status).
     */
    public WorkforceEmployeeResponse exit(UUID id, java.time.LocalDate lastWorkingDay, String reason,
                                          WorkforceEmployee.ExitType exitType) {
        WorkforceEmployee e = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + id + " not found"));
        e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.EXITED);
        e.setLastWorkingDay(lastWorkingDay);
        // The Exit centre's list rows carry no reason, so marking exited from there
        // sent none and wiped the one recorded with the notice. Keep it unless given.
        if (reason != null && !reason.isBlank()) e.setExitReason(reason);
        if (exitType != null) e.setExitType(exitType);
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
        e.setExitType(null);
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
    /** Months of probation a new hire gets when none is given (HR Configuration; 6 when the company has no row yet). */
    static final int DEFAULT_PROBATION_MONTHS = 6;

    /** The company's default probation length in months (HR Configuration), {@value #DEFAULT_PROBATION_MONTHS} when unset. */
    private int companyProbationMonths(UUID companyId) {
        if (companyId == null) return DEFAULT_PROBATION_MONTHS;
        Integer months = jdbc.query(
                "SELECT probation_period_months FROM settings.hr_configuration WHERE company_id = ?",
                rs -> rs.next() ? (Integer) rs.getObject(1) : null, companyId);
        return months == null || months < 0 ? DEFAULT_PROBATION_MONTHS : months;
    }

    /**
     * Sets a new hire's probation from the company default, unless a probation
     * end date is already there. {@code months > 0}: ends on the joining date
     * plus that many months. {@code months == 0}: no probation, so the person
     * starts confirmed on their joining date. Nothing changes without a joining date.
     */
    static void applyDefaultProbation(WorkforceEmployee e, int months) {
        if (e.getProbationEndDate() != null || e.getDateOfJoining() == null) return;
        if (months > 0) {
            e.setProbationEndDate(e.getDateOfJoining().plusMonths(months));
        } else {
            e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.ACTIVE);
            e.setConfirmationDate(e.getDateOfJoining());
        }
    }

    /** The company's weekly off days from HR Configuration as "6,7"; Sat+Sun if it has none. */
    private String companyOffDaysCsv(UUID companyId) {
        if (companyId == null) return "6,7";
        String csv = jdbc.query(
                "SELECT array_to_string(weekend_days, ',') FROM settings.hr_configuration WHERE company_id = ?",
                rs -> rs.next() ? rs.getString(1) : null, companyId);
        return csv == null || csv.isBlank() ? "6,7" : csv;
    }

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
                e.getConfirmationDate(), e.getNoticeStartDate(), e.getLastWorkingDay(), e.getExitReason(),
                e.getExitType(),
                ctc,
                e.getPfUan(), e.getEsiNumber(),
                e.getBankBranchName(),
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
                e.getConfirmationDate(), e.getNoticeStartDate(), e.getLastWorkingDay(), null /* exit reason is detail-only */,
                e.getExitType() /* not sensitive: the Exit centre lists it */,
                null /* ctcAnnual — redacted in list responses */,
                null /* uan */, null /* esi */,
                null /* bankBranchName — PII-adjacent, redacted in list */,
                null /* bankAcct */, null /* bankIfsc */,
                null /* monthlySalary */, null /* salaryFrequency */,
                parseWeeklyOffDays(e.getWeeklyOffDays()),
                e.getProfilePhotoUrl(),
                e.isFaceEnrolled(), checkHasAccount(e.getId()), e.isActive());
    }

    /**
     * Resolve a free-text designation title to a designation id, creating the
     * row if the tenant doesn't have it yet.
     *
     * <p>Context (2026-09-08 data-loss audit): the web Add-Employee form renders
     * a plain text input for Designation whenever the tenant has no designations
     * configured, and posts the typed value as {@code designation}. That key had
     * no field on {@link CreateWorkforceEmployeeRequest}, so Jackson dropped it
     * and the employee was saved with a null designation — HR typed a job title,
     * saw "Employee created", and the title vanished.
     *
     * <p>Match is case-insensitive on title within the company, and includes
     * archived rows so a previously-deleted title revives instead of colliding
     * with the non-partial unique index (same trap documented for departments /
     * designations in the org soft-delete fix).
     *
     * @return the designation id, or null when the title is blank
     */
    private UUID resolveOrCreateDesignation(UUID companyId, String title) {
        if (companyId == null || title == null || title.isBlank()) return null;
        String clean = title.trim();
        try {
            List<Map<String, Object>> existing = jdbc.queryForList(
                    "SELECT id, is_active FROM hrms.designations "
                            + "WHERE company_id = ? AND lower(title) = lower(?) LIMIT 1",
                    companyId, clean);
            if (!existing.isEmpty()) {
                UUID id = (UUID) existing.get(0).get("id");
                Boolean active = (Boolean) existing.get(0).get("is_active");
                if (Boolean.FALSE.equals(active)) {
                    // Revive rather than insert a duplicate — the unique index on
                    // (tenant_id, company_id, title) is NOT partial.
                    jdbc.update("UPDATE hrms.designations SET is_active = true WHERE id = ?", id);
                }
                return id;
            }
            return jdbc.queryForObject("""
                    INSERT INTO hrms.designations (id, tenant_id, company_id, title, is_active, created_at, updated_at)
                    VALUES (gen_random_uuid(), current_tenant_id(), ?, ?, true, now(), now())
                    RETURNING id
                    """, UUID.class, companyId, clean);
        } catch (Exception ex) {
            // Never fail the whole employee create over a designation lookup —
            // log and continue with a null designation.
            log.warn("resolveOrCreateDesignation('{}') failed: {}", clean, ex.getMessage());
            return null;
        }
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

    /**
     * The company's only active branch, or null when it has none or more than
     * one. RLS on org.branches scopes this to the caller's tenant. Never throws
     * — a failure here must not block onboarding over a display field.
     */
    private UUID soleActiveBranchOf(UUID companyId) {
        if (companyId == null) return null;
        try {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT id FROM org.branches WHERE company_id = ? AND is_active = TRUE LIMIT 2",
                    companyId);
            return rows.size() == 1 ? (UUID) rows.get(0).get("id") : null;
        } catch (Exception ex) {
            log.warn("sole-branch lookup failed for company {}: {}", companyId, ex.getMessage());
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
