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
    /** The upper-case branch type, or null when none was sent. Refuses unknown types. */
    static String normalizeType(String branchType) {
        if (branchType == null || branchType.isBlank()) return null;
        String t = branchType.trim().toUpperCase().replace(' ', '_');
        if (!BRANCH_TYPES.contains(t)) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Branch type must be one of " + String.join(", ", BRANCH_TYPES), "INVALID_BRANCH_TYPE");
        }
        return t;
    }

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
        // One headquarters per company: the previous one steps down in this
        // same transaction, before the new one is flagged (V143.14 index).
        if (b.isHeadquarters()) repository.clearHeadquarters(req.companyId());
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
        // A branch type wins over the old isHeadquarters flag (V143.22):
        // HEAD_OFFICE makes it the headquarters, any other type an ordinary branch.
        String type = normalizeType(req.branchType());
        Boolean requestedHq = type != null ? Boolean.valueOf("HEAD_OFFICE".equals(type)) : req.isHeadquarters();
        boolean hq = headquartersAfterUpdate(b, requestedHq, active);
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
        if (type != null) b.setBranchType(type);
        if (hq) b.setBranchType("HEAD_OFFICE");
        else if ("HEAD_OFFICE".equals(b.getBranchType())) b.setBranchType("BRANCH");
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
                b.isHeadquarters(), b.isActive(), typeOf(b));
    }
}
