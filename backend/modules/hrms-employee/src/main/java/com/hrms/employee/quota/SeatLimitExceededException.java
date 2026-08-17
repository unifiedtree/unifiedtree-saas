package com.hrms.employee.quota;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.util.UUID;

/**
 * Thrown when a create-employee call would push a workspace past the seat
 * count it has paid for, OR when the quota lookup itself failed and we
 * therefore cannot prove there is a seat available. Both cases surface as
 * HTTP 402 (Payment Required) via {@link SeatLimitExceptionHandler} so the
 * frontend can distinguish "you're out of seats, buy more" (or "we can't
 * verify right now — try again") from a generic 4xx.
 *
 * <p>Carries the numbers (purchased vs currently used) plus an upgrade CTA so
 * the UI can render "You've used {current}/{purchased} seats — upgrade to add
 * more" without a second round trip. For {@code QUOTA_LOOKUP_FAILED} the
 * numbers are -1 (unknown) and the UI should show the fallback message.
 */
public class SeatLimitExceededException extends HrmsException {

    /** Standard "over-cap" reject. */
    public static final String CODE_SEAT_LIMIT_EXCEEDED = "SEAT_LIMIT_EXCEEDED";
    /** Fail-closed reject: quota query itself blew up. */
    public static final String CODE_QUOTA_LOOKUP_FAILED = "QUOTA_LOOKUP_FAILED";

    private final UUID tenantId;
    private final int purchased;
    private final int current;
    private final String upgradeUrl;

    public SeatLimitExceededException(UUID tenantId, int purchased, int current) {
        super(buildMessage(purchased, current),
              HttpStatus.PAYMENT_REQUIRED,
              CODE_SEAT_LIMIT_EXCEEDED);
        this.tenantId   = tenantId;
        this.purchased  = purchased;
        this.current    = current;
        this.upgradeUrl = "/plan";
    }

    /**
     * Fail-closed constructor used when the quota lookup itself couldn't run
     * (bad SQL, DB outage, migration drift). We do NOT know the real numbers,
     * so purchased/current are stored as -1 and rendered as "—" on the UI.
     * Callers should pass {@link #CODE_QUOTA_LOOKUP_FAILED} as {@code code}.
     */
    public SeatLimitExceededException(UUID tenantId, String code, String message) {
        super(message, HttpStatus.PAYMENT_REQUIRED, code);
        this.tenantId   = tenantId;
        this.purchased  = -1;
        this.current    = -1;
        this.upgradeUrl = "/plan";
    }

    private static String buildMessage(int purchased, int current) {
        return "You've used " + current + " of " + purchased + " paid seats. "
                + "Upgrade your plan to bring more people on board.";
    }

    public UUID   getTenantId()   { return tenantId; }
    public int    getPurchased()  { return purchased; }
    public int    getCurrent()    { return current; }
    public String getUpgradeUrl() { return upgradeUrl; }
}
