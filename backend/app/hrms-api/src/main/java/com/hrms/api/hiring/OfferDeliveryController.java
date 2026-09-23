package com.hrms.api.hiring;

import com.hrms.hiring.dto.HiringOfferResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/v1/hiring/offers")
public class OfferDeliveryController {
    private final OfferDeliveryService service;
    public OfferDeliveryController(OfferDeliveryService service) { this.service = service; }
    public record SendRequest(@NotBlank @Email @Size(max = 254) String recipient) {}
    @PostMapping("/{id}/email")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.offer.write','hrms.hiring.write')")
    public HiringOfferResponse send(@PathVariable UUID id, @Valid @RequestBody SendRequest request) {
        return service.send(id, request.recipient());
    }
}
