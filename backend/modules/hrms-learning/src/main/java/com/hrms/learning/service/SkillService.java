package com.hrms.learning.service;

import com.hrms.core.tenant.TenantContext;
import com.hrms.learning.dto.EmployeeSkillRequest;
import com.hrms.learning.dto.EmployeeSkillResponse;
import com.hrms.learning.entity.EmployeeSkill;
import com.hrms.learning.repository.EmployeeSkillRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class SkillService {

    private static final Logger log = LoggerFactory.getLogger(SkillService.class);

    private final EmployeeSkillRepository skillRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public SkillService(EmployeeSkillRepository skillRepository, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.skillRepository = skillRepository;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<EmployeeSkillResponse> getSkills(UUID employeeId) {
        return skillRepository.findByEmployeeIdOrderBySkillNameAsc(employeeId).stream()
                .map(this::toResponse)
                .toList();
    }

    /**
     * Add a skill for an employee, or update the existing row when the same
     * skill name is recorded again (case-insensitive match per employee).
     */
    @Transactional
    public EmployeeSkillResponse upsertSkill(EmployeeSkillRequest request) {
        Integer employeeCount = jdbc.queryForObject("SELECT count(*) FROM hrms.employees WHERE id = ? AND tenant_id = ?", Integer.class, request.employeeId(), TenantContext.getTenantId());
        if (employeeCount == null || employeeCount == 0) throw new com.hrms.core.exception.BusinessRuleException("Employee not found in this workspace", "SKILL_EMPLOYEE_INVALID");
        if (request.expiresOn() != null && request.certifiedOn() != null && request.expiresOn().isBefore(request.certifiedOn())) {
            throw new com.hrms.core.exception.BusinessRuleException("Expiry cannot precede certification date", "CERTIFICATION_DATE_INVALID");
        }
        EmployeeSkill skill = skillRepository
                .findByEmployeeIdAndSkillNameIgnoreCase(request.employeeId(), request.skillName().trim())
                .orElseGet(() -> {
                    EmployeeSkill created = new EmployeeSkill();
                    created.setTenantId(TenantContext.getTenantId());
                    created.setEmployeeId(request.employeeId());
                    created.setSkillName(request.skillName().trim());
                    return created;
                });

        skill.setProficiency(request.proficiency() != null ? request.proficiency() : 1);
        boolean certified = request.certified() != null && request.certified();
        skill.setCertified(certified);
        skill.setCertificationName(certified ? request.certificationName() : null);
        skill.setCertifiedOn(certified ? request.certifiedOn() : null);
        skill.setExpiresOn(certified ? request.expiresOn() : null);
        skill = skillRepository.save(skill);

        log.info("Skill upserted employee={} skill={} proficiency={} certified={}",
                request.employeeId(), skill.getSkillName(), skill.getProficiency(), certified);
        return toResponse(skill);
    }

    private EmployeeSkillResponse toResponse(EmployeeSkill s) {
        return new EmployeeSkillResponse(
                s.getId(), s.getEmployeeId(), s.getSkillName(), s.getProficiency(),
                s.isCertified(), s.getCertificationName(), s.getCertifiedOn(), s.getCreatedAt(), s.getExpiresOn());
    }
}
