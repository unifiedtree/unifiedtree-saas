package com.hrms.letters.dto;

import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * Generate one letter for one employee.
 *
 * <ul>
 *   <li>{@code issueDate} (redesign BW-74, optional): the date the letter is
 *       issued on. The {@code today} merge fields print it, it is kept in the
 *       letter's generation context as {@code letter.issueDate}, and lists show
 *       it as "Issued". Left out, the letter is dated today, as before.</li>
 *   <li>{@code requestSignature} (redesign BW-76, optional): ask the employee to
 *       sign the letter (click to accept) once it is sent to them.</li>
 * </ul>
 */
public record GenerateLetterRequest(
        @NotNull(message = "Template ID is required")
        UUID templateId,

        @NotNull(message = "Employee ID is required")
        UUID employeeId,

        Map<String, String> overrides,

        boolean sendImmediately,

        String sendToEmail,

        LocalDate issueDate,

        boolean requestSignature
) {
    /** Today's shape (no issue date, no signature asked), for callers that predate BW-74 / BW-76. */
    public GenerateLetterRequest(UUID templateId, UUID employeeId, Map<String, String> overrides,
                                 boolean sendImmediately, String sendToEmail) {
        this(templateId, employeeId, overrides, sendImmediately, sendToEmail, null, false);
    }
}
