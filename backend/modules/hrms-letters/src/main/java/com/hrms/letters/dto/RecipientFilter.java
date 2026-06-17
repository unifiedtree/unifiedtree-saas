package com.hrms.letters.dto;

import java.util.List;
import java.util.UUID;

/**
 * Selects which employees a distribution targets. Resolved to a concrete
 * employee list at creation time (snapshot — later org changes don't apply).
 *
 * <ul>
 *   <li>ALL_EMPLOYEES        — every active employee in the tenant</li>
 *   <li>BY_COMPANY           — values = company IDs</li>
 *   <li>BY_DEPARTMENT        — values = department IDs</li>
 *   <li>BY_DESIGNATION       — values = designation IDs</li>
 *   <li>BY_EMPLOYMENT_TYPE   — values = employment-type names (FULL_TIME, ...)</li>
 *   <li>CUSTOM_LIST          — employeeIds = explicit employee IDs</li>
 * </ul>
 *
 * {@code values} is List&lt;String&gt; (not UUID) so the same field carries both
 * ID-typed filters and the enum-name employment-type filter.
 */
public record RecipientFilter(
        String type,
        List<String> values,
        List<UUID> employeeIds
) {
    public static final String ALL_EMPLOYEES      = "ALL_EMPLOYEES";
    public static final String BY_COMPANY         = "BY_COMPANY";
    public static final String BY_DEPARTMENT      = "BY_DEPARTMENT";
    public static final String BY_DESIGNATION     = "BY_DESIGNATION";
    public static final String BY_EMPLOYMENT_TYPE = "BY_EMPLOYMENT_TYPE";
    public static final String CUSTOM_LIST        = "CUSTOM_LIST";
}
