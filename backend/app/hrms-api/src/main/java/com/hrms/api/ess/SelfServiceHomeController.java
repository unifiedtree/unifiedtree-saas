package com.hrms.api.ess;

import com.hrms.api.ess.requests.MyRequest;
import com.hrms.api.ess.requests.MyRequestsService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The self-service Home's own reads (redesign P-HOME): the signed-in person's
 * requests, what needs them, and what is coming up around them.
 *
 * <p>Each list is personal: identity comes from the token only, so the
 * endpoints need just a signed-in user. Inside, every source is shown only with
 * the permission of its own page and only while its module is on, and one
 * failing source is reported in {@code unavailable} instead of failing the list.
 */
@RestController
@RequestMapping("/v1/ess")
@Tag(name = "Self-service", description = "The signed-in person's own requests, tasks and events")
@SecurityRequirement(name = "bearerAuth")
public class SelfServiceHomeController {

    private final MyRequestsService myRequests;
    /** "Today" is the India business date. Tests fix it. */
    Clock clock = Clock.system(ZoneId.of("Asia/Kolkata"));

    public SelfServiceHomeController(MyRequestsService myRequests) {
        this.myRequests = myRequests;
    }

    @Operation(summary = "My requests: leave, work from home, fixes, shift changes, expense claims and advances, waiting ones first")
    @GetMapping("/my-requests")
    @PreAuthorize("isAuthenticated()")
    public MyRequest.Response myRequests(@RequestParam(required = false) Integer limit,
                                         @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        return myRequests.myRequests(caller(jwt, auth), limit);
    }

    private EssCaller caller(Jwt jwt, Authentication auth) {
        return EssCaller.of(jwt, auth, TenantContext.getTenantId(), LocalDate.now(clock));
    }
}
