package com.hrms.api.ess;

import com.hrms.api.ess.around.CelebrationWishService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * "Send wishes" on Celebrations (V143.84; {@link CelebrationWishService}).
 * <ul>
 *   <li>{@code GET /v1/ess/celebrations/wishes}: the wishes the signed-in person
 *       received in the last week ("12 people wished you") and the ones they
 *       sent, so each button can say "Wished".</li>
 *   <li>{@code POST} the same path: send one. Sending the same wish again
 *       answers 200 with the wish already sent ({@code created: false}).</li>
 * </ul>
 * The Celebrations list's own check: anyone signed in with an employee record,
 * behind the hrms module ({@code /v1/ess}); identity comes from the token only.
 * Both answer 503 FEATURE_NOT_READY while V143.84 isn't applied.
 */
@RestController
@RequestMapping("/v1/ess/celebrations/wishes")
@Tag(name = "Self-service", description = "The signed-in person's own requests, tasks and events")
@SecurityRequirement(name = "bearerAuth")
public class CelebrationWishesController {

    private final CelebrationWishService wishes;
    /** "Today" is the India business date. Tests fix it. */
    Clock clock = Clock.system(ZoneId.of("Asia/Kolkata"));

    public CelebrationWishesController(CelebrationWishService wishes) {
        this.wishes = wishes;
    }

    @Operation(summary = "Wishes I received in the last week, and the ones I sent")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public CelebrationWishService.Mine mine(@AuthenticationPrincipal Jwt jwt, Authentication auth) {
        return wishes.mine(caller(jwt, auth));
    }

    @Operation(summary = "Send a colleague wishes on their birthday, their work anniversary, or to welcome them aboard")
    @PostMapping
    @PreAuthorize("isAuthenticated()")
    public CelebrationWishService.SendResult send(@RequestBody CelebrationWishService.SendRequest body,
                                                  @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        return wishes.send(caller(jwt, auth), body);
    }

    private EssCaller caller(Jwt jwt, Authentication auth) {
        return EssCaller.of(jwt, auth, TenantContext.getTenantId(), LocalDate.now(clock));
    }
}
