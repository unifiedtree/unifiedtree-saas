package com.hrms.api.team;

import java.util.List;
import java.util.UUID;

/** A team message was saved; {@link TeamNotifier} tells each recipient after the commit. */
public record TeamMessagePostedEvent(UUID tenantId, UUID messageId, List<UUID> recipients, String senderName,
                                     String body, String teamLabel) {
}
