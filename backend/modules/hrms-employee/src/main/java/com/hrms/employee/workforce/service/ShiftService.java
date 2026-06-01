package com.hrms.employee.workforce.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.entity.Shift;
import com.hrms.employee.workforce.repository.ShiftRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ShiftService {

    private final ShiftRepository repo;

    public ShiftService(ShiftRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<Shift> listForCompany(UUID companyId) {
        return repo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId);
    }

    @Transactional
    public Shift create(Shift shift) {
        shift.setTenantId(TenantContext.getTenantId());
        return repo.save(shift);
    }

    @Transactional
    public Shift update(UUID id, Shift update) {
        Shift existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Shift", id));
        existing.setName(update.getName());
        existing.setCode(update.getCode());
        existing.setStartTime(update.getStartTime());
        existing.setEndTime(update.getEndTime());
        existing.setGraceMinutes(update.getGraceMinutes());
        existing.setNightShift(update.isNightShift());
        existing.setDaysBitmask(update.getDaysBitmask());
        existing.setActive(update.isActive());
        return repo.save(existing);
    }

    @Transactional
    public void archive(UUID id) {
        Shift shift = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Shift", id));
        shift.setActive(false);
        repo.save(shift);
    }
}
