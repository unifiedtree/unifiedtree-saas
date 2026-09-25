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
import java.util.Map;
import java.util.UUID;

@Service("workforceBranchService")
@Transactional
public class BranchService {

    private final WorkforceBranchRepository repository;
    private final LiveHeadcount headcount;

    public BranchService(WorkforceBranchRepository repository, LiveHeadcount headcount) {
        this.repository = repository;
        this.headcount = headcount;
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listForCompany(UUID companyId) {
        return listForCompany(companyId, false);
    }

    /** {@code includeArchived}: also return archived (inactive) branches, for the "Inactive" filter. */
    @Transactional(readOnly = true)
    public List<BranchResponse> listForCompany(UUID companyId, boolean includeArchived) {
        Map<UUID, Integer> counts = headcount.byColumn("branch_id");
        return (includeArchived
                ? repository.findAllByCompanyIdOrderByNameAsc(companyId)
                : repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId))
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listAll() {
        return listAll(false);
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listAll(boolean includeArchived) {
        Map<UUID, Integer> counts = headcount.byColumn("branch_id");
        return (includeArchived
                ? repository.findAllByOrderByNameAsc()
                : repository.findAllByActiveTrueOrderByNameAsc())
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
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
        boolean hq = Boolean.TRUE.equals(req.isHeadquarters());
        // One headquarters per company: the previous one steps down in this
        // same transaction, before the new one is flagged (V143.14 index).
        if (hq) repository.clearHeadquarters(req.companyId());
        b.setHeadquarters(hq);
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
        boolean active = req.isActive() != null ? req.isActive() : b.isActive();
        boolean hq = headquartersAfterUpdate(b, req.isHeadquarters(), active);
        // One headquarters per company, swapped in this transaction: the
        // previous headquarters steps down BEFORE this branch is flagged, so the
        // unique index (V143.14) never sees two and the two can't diverge.
        if (hq) repository.clearHeadquartersExcept(b.getCompanyId(), b.getId());
        if (req.name() != null && !req.name().isBlank()) b.setName(req.name().trim());
        if (req.code() != null)          b.setCode(req.code().isBlank() ? null : req.code().trim());
        if (req.addressLine() != null)   b.setAddressLine(req.addressLine());
        if (req.city() != null)          b.setCity(req.city());
        if (req.state() != null)         b.setState(req.state());
        if (req.country() != null)       b.setCountry(req.country());
        if (req.pincode() != null)       b.setPincode(req.pincode());
        b.setHeadquarters(hq);
        b.setActive(active);
        return toResponse(repository.save(b));
    }

    /**
     * Whether the branch is the headquarters after an update.
     * <ul>
     *   <li>An inactive (archived) branch is never the headquarters.</li>
     *   <li>An explicit {@code isHeadquarters} wins; the caller's previous
     *       headquarters then steps down (see {@link #update}).</li>
     *   <li>Restoring an old headquarters while another branch has since become
     *       the headquarters keeps the current one: the restored branch comes
     *       back as an ordinary branch.</li>
     * </ul>
     */
    boolean headquartersAfterUpdate(Branch b, Boolean requested, boolean activeAfter) {
        if (!activeAfter) return false;
        if (requested != null) return requested;
        if (!b.isHeadquarters()) return false;
        boolean restoring = !b.isActive();
        return !(restoring && repository.existsByCompanyIdAndHeadquartersTrueAndActiveTrueAndIdNot(b.getCompanyId(), b.getId()));
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

    /** Soft archive. An archived branch is no longer the headquarters; pick another one. */
    public void archive(UUID branchId) {
        Branch b = repository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch " + branchId + " not found"));
        b.setActive(false);
        b.setHeadquarters(false);
        repository.save(b);
    }

    private BranchResponse toResponse(Branch b) {
        return toResponse(b, headcount.countFor("branch_id", b.getId()));
    }

    /** {@code employees}: people working there now (see LiveHeadcount), not the never-updated cached column. */
    private BranchResponse toResponse(Branch b, int employees) {
        return new BranchResponse(
                b.getId(), b.getCompanyId(), b.getName(), b.getCode(),
                b.getAddressLine(), b.getCity(), b.getState(), b.getCountry(), b.getPincode(),
                b.getLatitude(), b.getLongitude(),
                b.getGeoFenceRadiusMeters(), b.isGeoFenceEnforced(),
                b.getManagerEmployeeId(), employees,
                b.isHeadquarters(), b.isActive());
    }
}
