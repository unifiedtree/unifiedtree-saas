package com.hrms.api.notiftemplate;

import com.hrms.core.exception.HrmsException;
import com.hrms.notiftemplate.dto.NotificationTemplateRequest;
import com.hrms.notiftemplate.enums.NotificationChannel;
import com.unifiedtree.notifications.template.DeliveryChannel;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NotificationTemplateRulesTest {

    private static NotificationTemplateRequest req(NotificationChannel channel, String key, String subject, String body) {
        return new NotificationTemplateRequest(UUID.randomUUID(), "t", channel, key, subject, body, true);
    }

    @Test
    void storesTheCanonicalKeyForTheEnumSpelling() {
        var out = NotificationTemplateRules.validate(req(NotificationChannel.EMAIL, "LEAVE_APPROVED",
                "Leave approved", "Your {{leaveType}} from {{startDate}} is approved."));
        assertEquals("leave.approved", out.eventKey());
    }

    @Test
    void refusesPlaceholdersTheEventDoesNotProvide() {
        HrmsException e = assertThrows(HrmsException.class, () -> NotificationTemplateRules.validate(
                req(NotificationChannel.IN_APP, "leave.approved", "Hi {{salary}}", "Body")));
        assertTrue(e.getMessage().contains("{{salary}}"), e.getMessage());
        assertTrue(e.getMessage().contains("{{leaveType}}"), e.getMessage());
    }

    @Test
    void refusesChannelsTheEventIsNotSentOn() {
        assertThrows(HrmsException.class, () -> NotificationTemplateRules.validate(
                req(NotificationChannel.SMS, "leave.approved", null, "Body")));
        assertThrows(HrmsException.class, () -> NotificationTemplateRules.validate(
                req(NotificationChannel.PUSH, "account.password_reset", null, "{{resetLink}}")));
    }

    @Test
    void refusesUnknownEventsAndFixedWordingEvents() {
        assertThrows(HrmsException.class, () -> NotificationTemplateRules.validate(
                req(NotificationChannel.EMAIL, "made.up", null, "Body")));
        assertThrows(HrmsException.class, () -> NotificationTemplateRules.validate(
                req(NotificationChannel.IN_APP, "billing.payment_failed", null, "Body")));
    }

    @Test
    void publishesEveryEventWithPlaceholdersAndDefaults() {
        var events = NotificationTemplateRules.events();
        var invite = events.stream().filter(e -> e.key().equals("account.invitation")).findFirst().orElseThrow();
        assertTrue(invite.essential());
        assertTrue(invite.placeholders().stream().anyMatch(p -> p.name().equals("inviteLink") && p.link()));
        assertTrue(invite.defaults().get(DeliveryChannel.EMAIL).body().contains("{{inviteLink}}"));
        var billing = events.stream().filter(e -> e.key().equals("billing.payment_failed")).findFirst().orElseThrow();
        assertTrue(billing.templateChannels().isEmpty());
        assertFalse(events.stream().anyMatch(e -> e.key().isBlank()));
    }
}
