package com.hrms.api.hiring;

import com.hrms.hiring.dto.HiringOfferResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/hiring/offers")
public class OfferDeliveryController {
    private final OfferDeliveryService service;
    public OfferDeliveryController(OfferDeliveryService service) { this.service = service; }

    /** {@code recipient} may be left out (V143.59): the offer's candidate email is used then. */
    public record SendRequest(@Email @Size(max = 254) String recipient) {}

    /** DELIVERED = the operator confirmed the message arrived; NOT_SENT = confirmed it did not (allows a new send). */
    public record ResolveRequest(@NotNull Boolean delivered, @NotBlank @Size(max = 500) String note) {}

    @PostMapping("/{id}/email")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.offer.write','hrms.hiring.write')")
    public HiringOfferResponse send(@PathVariable UUID id, @Valid @RequestBody(required = false) SendRequest request,
                                    @AuthenticationPrincipal Jwt jwt) {
        return service.send(id, request == null ? null : request.recipient(), actor(jwt));
    }

    /** Every send of this offer with its outcome — the trail behind "was it emailed?". */
    @GetMapping("/{id}/email/attempts")
    @PreAuthorize("hasAuthority('hrms.hiring.offer.read')") // offers carry salary: offer.read only, not general hiring.read
    public List<OfferEmailAttemptStore.Attempt> attempts(@PathVariable UUID id) {
        return service.attempts(id);
    }

    @PostMapping("/{id}/email/attempts/{attemptId}/resolve")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.offer.write','hrms.hiring.write')")
    public HiringOfferResponse resolve(@PathVariable UUID id, @PathVariable UUID attemptId,
                                       @Valid @RequestBody ResolveRequest request, @AuthenticationPrincipal Jwt jwt) {
        return service.resolve(id, attemptId, request.delivered(), request.note(), actor(jwt));
    }

    private static String actor(Jwt jwt) {
        if (jwt == null) return null;
        String email = jwt.getClaimAsString("email");
        return email != null ? email : jwt.getSubject();
    }
}
