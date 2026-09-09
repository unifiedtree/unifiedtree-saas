package com.hrms.employee.workforce.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.BranchResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateBranchRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateGeofenceRequest;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service("workforceBranchService")
@Transactional
public class BranchService {

    private final WorkforceBranchRepository repository;

    public BranchService(WorkforceBranchRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listForCompany(UUID companyId) {
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listAll() {
        return repository.findAllByActiveTrueOrderByNameAsc()
                .stream().map(this::toResponse).toList();
    }

    public BranchResponse create(CreateBranchRequest req) {
        Branch b = new Branch();
        b.setCompanyId(req.companyId());
        b.setName(req.name());
        b.setCode(req.code());
        b.setAddressLine(req.addressLine());
        b.setCity(req.city());
        b.setState(req.state());
        b.setCountry(req.country() != null ? req.country() : "India");
        b.setPincode(req.pincode());
        b.setLatitude(req.latitude());
        b.setLongitude(req.longitude());
        b.setGeoFenceRadiusMeters(req.geoFenceRadiusMeters() != null ? req.geoFenceRadiusMeters() : 500);
        b.setHeadquarters(Boolean.TRUE.equals(req.isHeadquarters()));
        b.setActive(true);
        return toResponse(repository.save(b));
    }

    /**
     * Correct a branch's details. Partial: only non-null fields are applied, so
     * a caller sending {name} cannot blank the address. See UpdateBranchRequest
     * for why that matters here.
     */
    public BranchResponse update(UUID branchId, WorkforceDtos.UpdateBranchRequest req) {
        Branch b = repository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch " + branchId + " not found"));
        if (req.name() != null && !req.name().isBlank()) b.setName(req.name().trim());
        if (req.code() != null)          b.setCode(req.code().isBlank() ? null : req.code().trim());
        if (req.addressLine() != null)   b.setAddressLine(req.addressLine());
        if (req.city() != null)          b.setCity(req.city());
        if (req.state() != null)         b.setState(req.state());
        if (req.country() != null)       b.setCountry(req.country());
        if (req.pincode() != null)       b.setPincode(req.pincode());
        if (req.isHeadquarters() != null) b.setHeadquarters(req.isHeadquarters());
        if (req.isActive() != null)      b.setActive(req.isActive());
        return toResponse(repository.save(b));
    }

    public BranchResponse updateGeofence(UUID branchId, UpdateGeofenceRequest req) {
        Branch b = repository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch " + branchId + " not found"));
        b.setLatitude(req.latitude());
        b.setLongitude(req.longitude());
        b.setGeoFenceRadiusMeters(req.radiusMeters());
        if (req.enforced() != null) b.setGeoFenceEnforced(req.enforced());
        return toResponse(repository.save(b));
    }

    public void archive(UUID branchId) {
        Branch b = repository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch " + branchId + " not found"));
        b.setActive(false);
        repository.save(b);
    }

    private BranchResponse toResponse(Branch b) {
        return new BranchResponse(
                b.getId(), b.getCompanyId(), b.getName(), b.getCode(),
                b.getAddressLine(), b.getCity(), b.getState(), b.getCountry(), b.getPincode(),
                b.getLatitude(), b.getLongitude(),
                b.getGeoFenceRadiusMeters(), b.isGeoFenceEnforced(),
                b.getManagerEmployeeId(), b.getEmployeeCountCached(),
                b.isHeadquarters(), b.isActive());
    }
}
