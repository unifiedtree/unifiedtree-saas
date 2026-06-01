package com.hrms.employee.workforce.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.ClassificationRuleResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateClassificationRuleRequest;
import com.hrms.employee.workforce.entity.ClassificationRule;
import com.hrms.employee.workforce.repository.ClassificationRuleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class ClassificationRuleService {

    private final ClassificationRuleRepository repository;

    public ClassificationRuleService(ClassificationRuleRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<ClassificationRuleResponse> listForCompany(UUID companyId) {
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(this::toResponse).toList();
    }

    public ClassificationRuleResponse create(CreateClassificationRuleRequest req) {
        ClassificationRule r = new ClassificationRule();
        r.setCompanyId(req.companyId());
        r.setName(req.name());
        r.setCode(req.code());
        r.setDescription(req.description());
        r.setActive(true);
        return toResponse(repository.save(r));
    }

    public void archive(UUID id) {
        ClassificationRule r = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Classification rule " + id + " not found"));
        r.setActive(false);
        repository.save(r);
    }

    private ClassificationRuleResponse toResponse(ClassificationRule r) {
        return new ClassificationRuleResponse(
                r.getId(), r.getCompanyId(), r.getName(), r.getCode(),
                r.getDescription(), r.getHeadcountCached(), r.isActive());
    }
}
