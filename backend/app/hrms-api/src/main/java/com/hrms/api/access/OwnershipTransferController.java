package com.hrms.api.access;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Business settings → Ownership (OwnershipTransferService). Who may do what is checked in the
 * service: start / cancel / candidates — the owner; accept / decline — the person offered;
 * end the handover early — the new owner.
 */
@RestController
@RequestMapping("/v1/workspace/ownership-transfer")
@PreAuthorize("isAuthenticated()")
public class OwnershipTransferController {

    private final OwnershipTransferService transfers;

    public OwnershipTransferController(OwnershipTransferService transfers) {
        this.transfers = transfers;
    }

    public record StartRequest(UUID toUserId, String password, String note) {}

    /** The open transfer as the caller sees it (204 when there is none or it isn't theirs). */
    @GetMapping
    public ResponseEntity<OwnershipTransferService.Transfer> current(@AuthenticationPrincipal Jwt jwt) {
        OwnershipTransferService.Transfer t = transfers.current(TenantContext.getTenantId(), me(jwt));
        return t == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(t);
    }

    @GetMapping("/candidates")
    public List<OwnershipTransferService.Candidate> candidates(@AuthenticationPrincipal Jwt jwt) {
        return transfers.candidates(TenantContext.getTenantId(), me(jwt));
    }

    @PostMapping
    public OwnershipTransferService.Transfer start(@AuthenticationPrincipal Jwt jwt, @RequestBody StartRequest req) {
        return transfers.start(TenantContext.getTenantId(), me(jwt), req.toUserId(), req.password(), req.note());
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        transfers.cancel(TenantContext.getTenantId(), me(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/decline")
    public ResponseEntity<Void> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        transfers.decline(TenantContext.getTenantId(), me(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/accept")
    public OwnershipTransferService.Transfer accept(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return transfers.accept(TenantContext.getTenantId(), me(jwt), id);
    }

    @PostMapping("/{id}/end-transition")
    public ResponseEntity<Void> endTransition(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        transfers.endTransition(TenantContext.getTenantId(), me(jwt), id);
        return ResponseEntity.noContent().build();
    }

    private static UUID me(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
