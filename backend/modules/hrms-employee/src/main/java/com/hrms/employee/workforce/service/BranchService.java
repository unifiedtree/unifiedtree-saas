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
        Map<UUID, Integer> counts = headcount.byColumn("branch_id");
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listAll() {
        Map<UUID, Integer> counts = headcount.byColumn("branch_id");
        return repository.findAllByActiveTrueOrderByNameAsc()
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
    }

    /** Active and deactivated branches, for the include-archived filter (null company = all). */
    @Transactional(readOnly = true)
    public List<BranchResponse> listIncludingArchived(UUID companyId) {
        Map<UUID, Integer> counts = headcount.byColumn("branch_id");
        return (companyId == null ? repository.findAllByOrderByNameAsc() : repository.findAllByCompanyIdOrderByNameAsc(companyId))
                .stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0))).toList();
    }

    /** The branch types a branch can have (V143.22). */
    public static final List<String> BRANCH_TYPES = List.of("HEAD_OFFICE", "BRANCH", "PLANT", "WAREHOUSE", "OFFICE", "STORE", "OTHER");

    /**
     * What a branch is. is_headquarters decides the head office (it is what the
     * rest of the app reads), so an HQ is always HEAD_OFFICE, and a branch that
     * stopped being the HQ without being given another type reads as BRANCH.
     */
    public static String typeOf(Branch b) {
        if (b.isHeadquarters()) return "HEAD_OFFICE";
        String t = b.getBranchType();
        return t == null || "HEAD_OFFICE".equals(t) ? "BRANCH" : t;
    }

    /**
     * Apply a requested type and/or HQ flag. A type wins: HEAD_OFFICE makes it
     * the head office and any other type makes it an ordinary branch. Without a
     * type, the old isHeadquarters flag still works as before.
     */
    static void applyType(Branch b, String branchType, Boolean isHeadquarters) {
        if (branchType != null && !branchType.isBlank()) {
            String t = branchType.trim().toUpperCase().replace(' ', '_');
            if (!BRANCH_TYPES.contains(t)) {
                throw new com.hrms.core.exception.BusinessRuleException(
                        "Branch type must be one of " + String.join(", ", BRANCH_TYPES), "INVALID_BRANCH_TYPE");
            }
            b.setBranchType(t);
            b.setHeadquarters("HEAD_OFFICE".equals(t));
            return;
        }
        if (isHeadquarters != null) {
            b.setHeadquarters(isHeadquarters);
            if (isHeadquarters) b.setBranchType("HEAD_OFFICE");
            else if ("HEAD_OFFICE".equals(b.getBranchType())) b.setBranchType("BRANCH");
        }
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
        b.setHeadquarters(false);
        b.setBranchType("BRANCH");
        applyType(b, req.branchType(), Boolean.TRUE.equals(req.isHeadquarters()));
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
        applyType(b, req.branchType(), req.isHeadquarters());
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
                b.isHeadquarters(), b.isActive(), typeOf(b));
    }
}
