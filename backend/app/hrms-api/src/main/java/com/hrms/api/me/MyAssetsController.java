package com.hrms.api.me;

import com.hrms.api.onboarding.AssetCareService;
import com.hrms.api.onboarding.OnboardingViews;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * "My assets" (V143.20): the company equipment handed to the signed-in
 * employee, and what they have handed back. Always the caller's own record
 * (the employee id comes from the token, never from the request).
 *
 * <p>Redesign BW-70 (V143.59): the holder confirms they received an asset
 * ("Yes, I have it") or reports a problem with it. Until V143.59 is applied the
 * list carries no confirmation (nothing to confirm) and both actions answer
 * FEATURE_NOT_READY.
 */
@RestController
@RequestMapping("/v1/me/assets")
@SecurityRequirement(name = "bearerAuth")
public class MyAssetsController {

    private final JdbcTemplate jdbc;
    private final AssetCareService assetCare;

    public MyAssetsController(JdbcTemplate jdbc, AssetCareService assetCare) {
        this.jdbc = jdbc;
        this.assetCare = assetCare;
    }

    /**
     * {@code withMe} is true for what the employee holds now; returned items carry the return date and note.
     * <ul>
     *   <li>{@code confirmedAt}: when the holder confirmed they have it (or when it counted as confirmed
     *       because it was already with them when confirmations started); null otherwise.</li>
     *   <li>{@code canConfirm}: with me, and waiting for my confirmation.</li>
     *   <li>{@code openIssue}: a problem I reported with it that HR has not resolved yet.</li>
     * </ul>
     */
    public record MyAsset(UUID assetId, String assetTag, String assetType, String assetName, String serialNo,
                          LocalDate assignedAt, LocalDate returnedAt, String returnNotes, boolean withMe,
                          Instant confirmedAt, boolean canConfirm, OnboardingViews.IssueBrief openIssue) {}

    /** LOST, DAMAGED, NOT_WORKING or OTHER, and an optional note. */
    public record ProblemRequest(@NotBlank String kind, @Size(max = 1000) String note) {}

    @Operation(summary = "Equipment currently handed to me, and what I have returned")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.self')")
    @Transactional(readOnly = true)
    public List<MyAsset> mine(@AuthenticationPrincipal Jwt jwt) {
        UUID employee = employeeId(jwt);
        if (employee == null) return List.of();
        return list(employee);
    }

    @Operation(summary = "Confirm I received an asset that is with me")
    @PostMapping("/{assetId}/confirm")
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.self')")
    @Transactional
    public MyAsset confirm(@PathVariable UUID assetId, @AuthenticationPrincipal Jwt jwt) {
        UUID employee = employeeId(jwt);
        assetCare.confirm(employee, assetId);
        return one(employee, assetId);
    }

    @Operation(summary = "Report a problem with an asset that is with me (lost, damaged, not working, other)")
    @PostMapping("/{assetId}/problem")
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.self')")
    public ResponseEntity<AssetCareService.Issue> problem(@PathVariable UUID assetId, @Valid @RequestBody ProblemRequest req,
                                                          @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED).body(assetCare.report(employeeId(jwt), assetId, req.kind(), req.note()));
    }

    private MyAsset one(UUID employee, UUID assetId) {
        return list(employee).stream().filter(a -> a.assetId().equals(assetId) && a.withMe()).findFirst()
                .orElseThrow(() -> new HrmsException("This asset isn’t with you.", HttpStatus.NOT_FOUND, "ASSET_NOT_WITH_YOU"));
    }

    private List<MyAsset> list(UUID employee) {
        UUID tenant = TenantContext.requireTenantId();
        // Allocation history (V136) is the record of who held what; assets handed
        // out before that history existed are covered by the asset row itself.
        List<Object[]> rows = jdbc.query("""
                SELECT * FROM (
                    SELECT a.id, a.asset_tag, a.asset_type, a.asset_name, a.serial_no,
                           al.assigned_at, al.returned_at, al.return_notes,
                           (al.returned_at IS NULL AND a.status = 'ASSIGNED' AND a.employee_id = al.employee_id) AS with_me,
                           al.id AS allocation_id
                      FROM hrms.asset_allocations al
                      JOIN hrms.onboarding_assets a ON a.id = al.asset_id AND a.tenant_id = al.tenant_id
                     WHERE al.tenant_id = ? AND al.employee_id = ?
                    UNION ALL
                    SELECT a.id, a.asset_tag, a.asset_type, a.asset_name, a.serial_no,
                           a.assigned_at, NULL::date, NULL, TRUE, NULL::uuid
                      FROM hrms.onboarding_assets a
                     WHERE a.tenant_id = ? AND a.employee_id = ? AND a.status = 'ASSIGNED'
                       AND NOT EXISTS (SELECT 1 FROM hrms.asset_allocations al
                                        WHERE al.tenant_id = a.tenant_id AND al.asset_id = a.id
                                          AND al.employee_id = a.employee_id AND al.returned_at IS NULL)
                ) x
                ORDER BY with_me DESC, COALESCE(returned_at, assigned_at) DESC NULLS LAST, asset_tag
                """, (rs, i) -> new Object[]{new MyAsset(rs.getObject("id", UUID.class), rs.getString("asset_tag"), rs.getString("asset_type"),
                        rs.getString("asset_name"), rs.getString("serial_no"), rs.getObject("assigned_at", LocalDate.class),
                        rs.getObject("returned_at", LocalDate.class), rs.getString("return_notes"), rs.getBoolean("with_me"),
                        null, false, null), rs.getObject("allocation_id", UUID.class)},
                tenant, employee, tenant, employee);
        if (rows.isEmpty()) return List.of();

        boolean ready = assetCare.confirmationsReady();
        Map<UUID, Instant> confirmed = ready ? assetCare.confirmationsOf(employee) : Map.of();
        List<UUID> held = rows.stream().map(r -> (MyAsset) r[0]).filter(MyAsset::withMe).map(MyAsset::assetId).toList();
        Map<UUID, OnboardingViews.IssueBrief> open = assetCare.openIssues(tenant, held);
        List<MyAsset> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            MyAsset a = (MyAsset) r[0];
            UUID allocation = (UUID) r[1];
            Instant confirmedAt = allocation == null ? null : confirmed.get(allocation);
            boolean canConfirm = ready && a.withMe() && allocation != null && confirmedAt == null;
            out.add(new MyAsset(a.assetId(), a.assetTag(), a.assetType(), a.assetName(), a.serialNo(), a.assignedAt(),
                    a.returnedAt(), a.returnNotes(), a.withMe(), confirmedAt, canConfirm,
                    a.withMe() ? open.get(a.assetId()) : null));
        }
        return out;
    }

    /** The caller's employee record; null for an account without one. */
    private static UUID employeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try {
            return UUID.fromString(claim);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
