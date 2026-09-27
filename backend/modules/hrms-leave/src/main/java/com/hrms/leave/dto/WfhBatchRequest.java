package com.hrms.leave.dto;

import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

/**
 * Body for POST /v1/wfh/batch: several separate days from home in one send.
 * The days need not be next to each other; each run of consecutive days is
 * stored as one request, all in one transaction, and the approver gets one
 * notification. The day and reason rules are the single request's.
 */
public record WfhBatchRequest(
        @NotEmpty(message = "Pick at least one day")
        @Size(max = WfhBatchRequest.MAX_DAYS, message = "Pick at most 31 days in one request")
        List<@NotNull(message = "A day is missing") @FutureOrPresent(message = "Days cannot be in the past") LocalDate> dates,

        @Size(max = 500, message = "Reason must be 500 characters or fewer")
        String reason
) {
    /** The most days one batch may ask for. */
    public static final int MAX_DAYS = 31;
}
