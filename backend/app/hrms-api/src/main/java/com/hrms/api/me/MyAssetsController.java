package com.hrms.api.me;

import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * "My assets" (V143.20): the company equipment handed to the signed-in
 * employee, and what they have handed back. Always the caller's own record
 * (the employee id comes from the token, never from the request).
 */
@RestController
@RequestMapping("/v1/me/assets")
@SecurityRequirement(name = "bearerAuth")
public class MyAssetsController {

    private final JdbcTemplate jdbc;

    public MyAssetsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** {@code withMe} is true for what the employee holds now; returned items carry the return date and note. */
    public record MyAsset(UUID assetId, String assetTag, String assetType, String assetName, String serialNo,
                          LocalDate assignedAt, LocalDate returnedAt, String returnNotes, boolean withMe) {}

    @Operation(summary = "Equipment currently handed to me, and what I have returned")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.self')")
    @Transactional(readOnly = true)
    public List<MyAsset> mine(@AuthenticationPrincipal Jwt jwt) {
        String claim = jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return List.of();
        UUID employee = UUID.fromString(claim);
        UUID tenant = TenantContext.requireTenantId();
        // Allocation history (V136) is the record of who held what; assets handed
        // out before that history existed are covered by the asset row itself.
        return jdbc.query("""
                SELECT * FROM (
                    SELECT a.id, a.asset_tag, a.asset_type, a.asset_name, a.serial_no,
                           al.assigned_at, al.returned_at, al.return_notes,
                           (al.returned_at IS NULL AND a.status = 'ASSIGNED' AND a.employee_id = al.employee_id) AS with_me
                      FROM hrms.asset_allocations al
                      JOIN hrms.onboarding_assets a ON a.id = al.asset_id AND a.tenant_id = al.tenant_id
                     WHERE al.tenant_id = ? AND al.employee_id = ?
                    UNION ALL
                    SELECT a.id, a.asset_tag, a.asset_type, a.asset_name, a.serial_no,
                           a.assigned_at, NULL::date, NULL, TRUE
                      FROM hrms.onboarding_assets a
                     WHERE a.tenant_id = ? AND a.employee_id = ? AND a.status = 'ASSIGNED'
                       AND NOT EXISTS (SELECT 1 FROM hrms.asset_allocations al
                                        WHERE al.tenant_id = a.tenant_id AND al.asset_id = a.id
                                          AND al.employee_id = a.employee_id AND al.returned_at IS NULL)
                ) x
                ORDER BY with_me DESC, COALESCE(returned_at, assigned_at) DESC NULLS LAST, asset_tag
                """, (rs, i) -> new MyAsset(rs.getObject("id", UUID.class), rs.getString("asset_tag"), rs.getString("asset_type"),
                        rs.getString("asset_name"), rs.getString("serial_no"), rs.getObject("assigned_at", LocalDate.class),
                        rs.getObject("returned_at", LocalDate.class), rs.getString("return_notes"), rs.getBoolean("with_me")),
                tenant, employee, tenant, employee);
    }
}
