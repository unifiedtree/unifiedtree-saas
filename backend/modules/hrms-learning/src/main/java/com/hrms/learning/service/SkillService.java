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

    public SkillService(EmployeeSkillRepository skillRepository) {
        this.skillRepository = skillRepository;
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
        skill = skillRepository.save(skill);

        log.info("Skill upserted employee={} skill={} proficiency={} certified={}",
                request.employeeId(), skill.getSkillName(), skill.getProficiency(), certified);
        return toResponse(skill);
    }

    private EmployeeSkillResponse toResponse(EmployeeSkill s) {
        return new EmployeeSkillResponse(
                s.getId(), s.getEmployeeId(), s.getSkillName(), s.getProficiency(),
                s.isCertified(), s.getCertificationName(), s.getCertifiedOn(), s.getCreatedAt());
    }
}
