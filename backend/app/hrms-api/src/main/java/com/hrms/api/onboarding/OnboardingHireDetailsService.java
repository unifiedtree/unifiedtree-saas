package com.hrms.api.onboarding;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * The hire details kept on an onboarding (V143.20): when the offer was
 * accepted, the hiring manager, the recruiter, where the hire came from and
 * their onboarding buddy. Filled from the candidate, requisition and accepted
 * offer when the onboarding starts for a converted candidate
 * ({@code OnboardingService.prefillHireDetails}); HR can change them.
 */
@Service
public class OnboardingHireDetailsService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public OnboardingHireDetailsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Person(UUID id, String name) {}

    /**
     * @param fromHiring true when there is no onboarding yet and the details are
     *                   read straight from the hiring record (read-only)
     */
    public record HireDetails(UUID instanceId, UUID employeeId, UUID candidateId, LocalDate offerAcceptedOn,
                              Person hiringManager, Person recruiter, Person buddy, String source, boolean fromHiring) {
        @com.fasterxml.jackson.annotation.JsonIgnore
        public boolean isEmpty() {
            return offerAcceptedOn == null && hiringManager == null && recruiter == null && buddy == null
                    && (source == null || source.isBlank());
        }
    }

    public record UpdateRequest(LocalDate offerAcceptedOn, UUID hiringManagerId, UUID recruiterId, UUID buddyId, String source) {}

    @Transactional(readOnly = true)
    public HireDetails get(UUID instanceId) {
        UUID tenant = TenantContext.requireTenantId();
        List<HireDetails> rows = jdbc.query(SELECT + " WHERE i.tenant_id = ? AND i.id = ?", (rs, n) -> map(rs, false), tenant, instanceId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("OnboardingInstance", instanceId);
        return rows.getFirst();
    }

    /** Owner of an onboarding (for the self-view check). */
    @Transactional(readOnly = true)
    public UUID employeeOf(UUID instanceId) {
        UUID tenant = TenantContext.requireTenantId();
        List<UUID> ids = jdbc.queryForList("SELECT employee_id FROM hrms.onboarding_instances WHERE tenant_id = ? AND id = ?",
                UUID.class, tenant, instanceId);
        if (ids.isEmpty()) throw new ResourceNotFoundException("OnboardingInstance", instanceId);
        return ids.getFirst();
    }

    /**
     * For the employee workspace: the latest onboarding's details, or, when the
     * person has no onboarding yet but was hired through the pipeline, the same
     * facts read from the candidate, requisition and accepted offer. Null when
     * neither exists.
     */
    @Transactional(readOnly = true)
    public HireDetails forEmployee(UUID employeeId) {
        UUID tenant = TenantContext.requireTenantId();
        List<HireDetails> rows = jdbc.query(SELECT + " WHERE i.tenant_id = ? AND i.employee_id = ? ORDER BY i.created_at DESC LIMIT 1",
                (rs, n) -> map(rs, false), tenant, employeeId);
        if (!rows.isEmpty()) return rows.getFirst();
        List<HireDetails> hiring = jdbc.query("""
                SELECT NULL::uuid AS instance_id, c.converted_employee_id AS employee_id, c.id AS candidate_id,
                       (SELECT (COALESCE(o.responded_at, o.updated_at) AT TIME ZONE 'Asia/Kolkata')::date
                          FROM hiring_mgmt.offers o
                         WHERE o.tenant_id = c.tenant_id AND o.candidate_id = c.id AND o.status = 'ACCEPTED'
                         ORDER BY o.responded_at DESC NULLS LAST, o.created_at DESC LIMIT 1) AS offer_accepted_on,
                       hm.id AS hm_id, concat_ws(' ', hm.first_name, hm.last_name) AS hm_name,
                       rc.id AS rc_id, concat_ws(' ', rc.first_name, rc.last_name) AS rc_name,
                       NULL::uuid AS bd_id, NULL AS bd_name, left(c.source, 80) AS hire_source
                  FROM hiring_mgmt.candidates c
                  JOIN hiring_mgmt.job_requisitions r ON r.id = c.requisition_id AND r.tenant_id = c.tenant_id
                  LEFT JOIN hrms.employees hm ON hm.id = r.hiring_manager_id AND hm.tenant_id = r.tenant_id
                  LEFT JOIN auth.user_credentials uc ON uc.tenant_id = c.tenant_id AND uc.id::text = c.created_by
                  LEFT JOIN hrms.employees rc ON rc.id = uc.employee_id AND rc.tenant_id = uc.tenant_id
                 WHERE c.tenant_id = ? AND c.converted_employee_id = ?
                 LIMIT 1
                """, (rs, n) -> map(rs, true), tenant, employeeId);
        return hiring.isEmpty() ? null : hiring.getFirst();
    }

    @Transactional
    public HireDetails update(UUID instanceId, UpdateRequest body) {
        UUID tenant = TenantContext.requireTenantId();
        UUID employee = employeeOf(instanceId);
        UpdateRequest req = body == null ? new UpdateRequest(null, null, null, null, null) : body;
        LocalDate today = LocalDate.now(IST);
        if (req.offerAcceptedOn() != null && req.offerAcceptedOn().isAfter(today))
            throw new BusinessRuleException("The offer accepted date can't be in the future", "HIRE_OFFER_DATE_FUTURE");
        String source = req.source() == null || req.source().isBlank() ? null : req.source().trim();
        if (source != null && source.length() > 80)
            throw new BusinessRuleException("Keep the source under 80 characters", "HIRE_SOURCE_TOO_LONG");
        if (req.buddyId() != null && req.buddyId().equals(employee))
            throw new BusinessRuleException("Choose someone other than the new hire as their buddy", "HIRE_BUDDY_SELF");
        List<UUID> people = new ArrayList<>();
        for (UUID id : new UUID[] {req.hiringManagerId(), req.recruiterId(), req.buddyId()}) if (id != null && !people.contains(id)) people.add(id);
        for (UUID id : people) {
            Integer ok = jdbc.queryForObject("""
                    SELECT count(*) FROM hrms.employees
                     WHERE tenant_id = ? AND id = ? AND is_active
                       AND COALESCE(employment_status, 'ACTIVE') NOT IN ('EXITED', 'TERMINATED', 'SUSPENDED')
                    """, Integer.class, tenant, id);
            if (ok == null || ok == 0)
                throw new BusinessRuleException("The hiring manager, recruiter and buddy must be current employees", "HIRE_PERSON_INVALID");
        }
        jdbc.update("""
                UPDATE hrms.onboarding_instances
                   SET offer_accepted_on = ?, hiring_manager_id = ?, recruiter_id = ?, buddy_id = ?, hire_source = ?, updated_at = now()
                 WHERE tenant_id = ? AND id = ?
                """, req.offerAcceptedOn(), req.hiringManagerId(), req.recruiterId(), req.buddyId(), source, tenant, instanceId);
        return get(instanceId);
    }

    private static final String SELECT = """
            SELECT i.id AS instance_id, i.employee_id, i.candidate_id, i.offer_accepted_on,
                   hm.id AS hm_id, concat_ws(' ', hm.first_name, hm.last_name) AS hm_name,
                   rc.id AS rc_id, concat_ws(' ', rc.first_name, rc.last_name) AS rc_name,
                   bd.id AS bd_id, concat_ws(' ', bd.first_name, bd.last_name) AS bd_name,
                   i.hire_source
              FROM hrms.onboarding_instances i
              LEFT JOIN hrms.employees hm ON hm.id = i.hiring_manager_id AND hm.tenant_id = i.tenant_id
              LEFT JOIN hrms.employees rc ON rc.id = i.recruiter_id AND rc.tenant_id = i.tenant_id
              LEFT JOIN hrms.employees bd ON bd.id = i.buddy_id AND bd.tenant_id = i.tenant_id
            """;

    private static HireDetails map(java.sql.ResultSet rs, boolean fromHiring) throws java.sql.SQLException {
        return new HireDetails(rs.getObject("instance_id", UUID.class), rs.getObject("employee_id", UUID.class),
                rs.getObject("candidate_id", UUID.class), rs.getObject("offer_accepted_on", LocalDate.class),
                person(rs.getObject("hm_id", UUID.class), rs.getString("hm_name")),
                person(rs.getObject("rc_id", UUID.class), rs.getString("rc_name")),
                person(rs.getObject("bd_id", UUID.class), rs.getString("bd_name")),
                rs.getString("hire_source"), fromHiring);
    }

    private static Person person(UUID id, String name) {
        return id == null ? null : new Person(id, Objects.requireNonNullElse(name, "").trim());
    }
}
