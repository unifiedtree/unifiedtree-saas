package com.hrms.api.workforce;

import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
import com.hrms.api.workforce.search.PersonFactsQueries;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /v1/search?q=…} — the ⌘K palette's entity search (Milestone 4C).
 *
 * <p>Only employees today. The response is grouped ({@code employees: [...]})
 * so a later group can be added without breaking the client, but no other
 * entity is searched here and none should be bolted on without its own
 * permission gate.
 *
 * <p>Authorisation is exactly the Workforce Directory's: the same
 * {@code hasAuthority('hrms.employee.read')} check that guards
 * {@code GET /v1/hrms/employees}, and the same RLS tenant fence underneath.
 * There is no second permission code and no client-side filtering — a caller
 * who cannot list the directory gets 403 here, and a caller who can gets
 * precisely the rows the directory would show.
 */
@RestController
@RequestMapping("/v1/search")
public class SearchController {

    private final WorkforceEmployeeService employees;
    private final PersonFactsQueries facts;

    public SearchController(WorkforceEmployeeService employees, PersonFactsQueries facts) {
        this.employees = employees;
        this.facts = facts;
    }

    /**
     * @param q     at least {@value WorkforceEmployeeService#SEARCH_MIN_QUERY_CHARS}
     *              non-blank characters, otherwise 400. Matched case-insensitively
     *              against first name, last name, full name, employee code and
     *              work email.
     * @param limit page size, clamped to
     *              [1, {@value WorkforceEmployeeService#SEARCH_MAX_LIMIT}];
     *              default {@value WorkforceEmployeeService#SEARCH_DEFAULT_LIMIT}.
     */
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    public EmployeeSearchResponse search(
            @RequestParam String q,
            @RequestParam(defaultValue = "" + WorkforceEmployeeService.SEARCH_DEFAULT_LIMIT) int limit) {
        if (WorkforceEmployeeService.normalizeSearchQuery(q).length()
                < WorkforceEmployeeService.SEARCH_MIN_QUERY_CHARS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "q must be at least " + WorkforceEmployeeService.SEARCH_MIN_QUERY_CHARS + " characters");
        }
        return employees.search(q, limit);
    }

    /**
     * Redesign BW-02: the preview facts (branch, manager, joining date, employment status) for the people
     * a search returned. The same gate and visibility as the search itself; at most
     * {@value PersonFactsQueries#MAX_IDS} ids, more is a 400.
     */
    @GetMapping("/people/facts")
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    public List<PersonFactsQueries.PersonFacts> facts(@RequestParam List<UUID> ids) {
        if (ids.size() > PersonFactsQueries.MAX_IDS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ask for at most " + PersonFactsQueries.MAX_IDS + " people");
        }
        return facts.facts(TenantContext.getTenantId(), ids);
    }
}
