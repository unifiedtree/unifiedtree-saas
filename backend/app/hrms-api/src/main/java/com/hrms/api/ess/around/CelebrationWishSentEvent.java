package com.hrms.api.ess.around;

import java.util.UUID;

/** A wish was saved; {@link CelebrationWishNotifier} tells the person after the commit. */
public record CelebrationWishSentEvent(UUID tenantId, UUID wishId, UUID toEmployeeId, UUID fromEmployeeId,
                                       String senderName, CelebrationWishService.Occasion occasion, String message) {
}
