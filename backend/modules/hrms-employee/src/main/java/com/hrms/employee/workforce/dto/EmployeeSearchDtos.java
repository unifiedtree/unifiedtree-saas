package com.hrms.employee.workforce.dto;

import java.util.List;
import java.util.UUID;

/**
 * Wire shape for {@code GET /v1/search} (Milestone 4C — employee entity search).
 *
 * <p>Deliberately NOT {@link WorkforceDtos.WorkforceEmployeeResponse}. That
 * record carries salary, bank, UAN/ESI, phone and date of birth; the by-id
 * endpoint gates those behind {@code hrms.employees.pii.read}, and the list
 * variant has to null them out one by one. A typeahead hit needs six fields,
 * so it gets a record that cannot carry the others even by accident.
 */
public final class EmployeeSearchDtos {

    private EmployeeSearchDtos() {}

    /**
     * One employee hit. Every field here is already visible on the Workforce
     * Directory list to anyone holding {@code hrms.employee.read}; nothing
     * elevated is added.
     *
     * @param profilePhotoUrl same value the directory renders as the avatar;
     *                        null when the employee has no photo.
     */
    public record EmployeeSearchHit(
            UUID id,
            String displayName,
            String employeeCode,
            String departmentName,
            String jobTitle,
            String profilePhotoUrl) {}

    /**
     * @param limit     the effective (clamped) page size the server applied.
     * @param truncated true when more employees matched than {@code limit};
     *                  the client should ask the user to narrow the query
     *                  rather than page through.
     */
    public record EmployeeSearchResponse(
            List<EmployeeSearchHit> employees,
            int limit,
            boolean truncated) {}
}
