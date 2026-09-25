package com.hrms.api.workforce.search;

import java.util.List;

/**
 * Wire shape for {@code GET /v1/search/global} (the top bar's search).
 *
 * <p>Every hit carries only what its own list page already shows the caller:
 * names, codes, titles, dates and statuses. Never salary, CTC, amounts, bank or
 * identity numbers.
 */
public final class GlobalSearchDtos {

    private GlobalSearchDtos() {}

    /**
     * One result.
     *
     * @param type     the group it belongs to (employee, leave, payslip, …)
     * @param id       the record's id
     * @param title    first line
     * @param subtitle second line; null when there is nothing to add
     * @param url      the in-app page that opens it, with that page's search
     *                 prefilled where the page has one
     * @param badge    a short status ("Pending", "Draft"); null when none
     */
    public record SearchHit(String type, String id, String title, String subtitle, String url, String badge) {}

    /** The hits of one type, in the order the server ranked them. */
    public record SearchGroup(String type, String label, List<SearchHit> items) {}

    /**
     * @param query       the normalised query that was searched
     * @param groups      non-empty groups only, in a fixed order
     * @param unavailable types the caller may search that failed this time;
     *                    the client says so instead of pretending there are none
     */
    public record GlobalSearchResponse(String query, List<SearchGroup> groups, List<String> unavailable) {}
}
