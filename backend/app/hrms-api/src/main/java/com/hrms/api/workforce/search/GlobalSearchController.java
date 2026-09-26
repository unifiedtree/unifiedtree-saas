package com.hrms.api.workforce.search;

import com.hrms.api.workforce.search.GlobalSearchDtos.GlobalSearchResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * {@code GET /v1/search/global?q=…&limit=…} — the top bar's search.
 *
 * <p>Open to every signed-in person: what each one gets back is decided per
 * type by the permission that type's own list page needs
 * ({@link GlobalSearchAccess}), so an employee finds their own leave, payslips
 * and documents and never anyone else's. The ⌘K palette ("Advanced search")
 * keeps using {@code GET /v1/search} for people, unchanged.
 */
@RestController
@RequestMapping("/v1/search/global")
public class GlobalSearchController {

    private final GlobalSearchService service;

    public GlobalSearchController(GlobalSearchService service) {
        this.service = service;
    }

    /**
     * @param q     at least two characters (after trimming), otherwise 400
     * @param limit results per type, clamped to [1, {@value GlobalSearchService#MAX_LIMIT}]
     */
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public GlobalSearchResponse search(@RequestParam String q,
                                       @RequestParam(defaultValue = "" + GlobalSearchService.DEFAULT_LIMIT) int limit,
                                       @AuthenticationPrincipal Jwt jwt,
                                       Authentication auth) {
        if (SearchText.of(q).tooShort()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "q must be at least " + SearchText.MIN_QUERY_CHARS + " characters");
        }
        return service.search(q, limit, jwt, auth, TenantContext.getTenantId());
    }
}
