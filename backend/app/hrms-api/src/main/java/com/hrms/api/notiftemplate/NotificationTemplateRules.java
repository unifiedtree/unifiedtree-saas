package com.hrms.api.notiftemplate;

import com.hrms.core.exception.HrmsException;
import com.hrms.notiftemplate.dto.NotificationTemplateRequest;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import com.unifiedtree.notifications.template.NotificationEventCatalog.Placeholder;
import com.unifiedtree.notifications.template.TemplateRenderer;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What a notification template may say, checked before it is saved, so an
 * admin can't save a template that would never be used or that shows blanks:
 * the event must exist and allow templates, the channel must be one the event
 * is sent on, and every {{placeholder}} must be one the event provides.
 * The event key is stored in its canonical form (e.g. {@code leave.approved}).
 */
public final class NotificationTemplateRules {

    private NotificationTemplateRules() {}

    /** Returns the request with the canonical event key, or throws a 400 with a plain-English reason. */
    public static NotificationTemplateRequest validate(NotificationTemplateRequest req) {
        EventDef def = NotificationEventCatalog.byKey(req.eventKey()).orElseThrow(() ->
                bad("There's no notification event called \"" + req.eventKey() + "\". Pick one from the list."));
        if (def.templateChannels().isEmpty()) {
            throw bad("\"" + def.label() + "\" uses fixed wording, so it can't have a template.");
        }
        DeliveryChannel channel = toDelivery(req.channel() == null ? null : req.channel().name());
        if (channel == null || !def.templatable(channel)) {
            throw bad("\"" + def.label() + "\" isn't sent by " + label(req.channel() == null ? "that channel" : req.channel().name())
                    + ". It can use: " + def.templateChannels().stream().map(c -> label(c.name())).collect(Collectors.joining(", ")) + ".");
        }
        Set<String> used = new LinkedHashSet<>(TemplateRenderer.placeholders(req.subject()));
        used.addAll(TemplateRenderer.placeholders(req.body()));
        List<String> unknown = new ArrayList<>();
        for (String name : used) if (def.placeholder(name) == null) unknown.add("{{" + name + "}}");
        if (!unknown.isEmpty()) {
            String allowed = def.placeholders().isEmpty() ? "none"
                    : def.placeholders().stream().map(p -> "{{" + p.name() + "}}").collect(Collectors.joining(", "));
            throw bad(String.join(", ", unknown) + (unknown.size() == 1 ? " isn't" : " aren't")
                    + " available for \"" + def.label() + "\". You can use: " + allowed + ".");
        }
        // Always-sent emails exist to hand over a link (set a password, reset it).
        // A template without that link would send people an email they can't act
        // on, and they'd be locked out, so the link placeholder is required.
        if (def.essential() && channel == DeliveryChannel.EMAIL) {
            Set<String> inBody = TemplateRenderer.placeholders(req.body());
            List<String> missing = def.placeholders().stream()
                    .filter(Placeholder::link)
                    .map(Placeholder::name)
                    .filter(n -> !inBody.contains(n))
                    .map(n -> "{{" + n + "}}")
                    .toList();
            if (!missing.isEmpty()) {
                throw bad("\"" + def.label() + "\" is how people get into their account, so the message must include "
                        + String.join(" and ", missing) + ". Without it the email can't be acted on.");
            }
        }
        return new NotificationTemplateRequest(req.companyId(), req.name(), req.channel(), def.key(),
                req.subject(), req.body(), req.active());
    }

    // ── the event list for the template editor ───────────────────────────────

    public record PlaceholderDto(String name, String description, boolean link) {}

    public record DefaultText(String subject, String body) {}

    public record EventDto(String key, String alias, String group, String label, String audience, String description,
                           List<DeliveryChannel> channels, List<DeliveryChannel> templateChannels,
                           boolean essential, boolean external,
                           List<PlaceholderDto> placeholders, Map<DeliveryChannel, DefaultText> defaults) {}

    public static List<EventDto> events() {
        return NotificationEventCatalog.all().stream().map(NotificationTemplateRules::toDto).toList();
    }

    private static EventDto toDto(EventDef d) {
        Map<DeliveryChannel, DefaultText> defaults = new EnumMap<>(DeliveryChannel.class);
        for (DeliveryChannel c : d.templateChannels()) defaults.put(c, new DefaultText(d.defaultSubject(c), d.defaultBodyFor(c)));
        List<PlaceholderDto> ph = d.placeholders().stream()
                .map((Placeholder p) -> new PlaceholderDto(p.name(), p.description(), p.link())).toList();
        return new EventDto(d.key(), d.alias(), d.group(), d.label(), d.audience(), d.description(),
                List.copyOf(d.channels()), List.copyOf(d.templateChannels()), d.essential(), d.external(), ph, defaults);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static DeliveryChannel toDelivery(String name) {
        if (name == null) return null;
        try { return DeliveryChannel.valueOf(name); } catch (IllegalArgumentException e) { return null; }
    }

    private static String label(String channel) {
        return switch (channel) {
            case "IN_APP" -> "in-app";
            case "PUSH" -> "push";
            case "EMAIL" -> "email";
            case "SMS" -> "SMS";
            default -> channel;
        };
    }

    private static HrmsException bad(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "INVALID_NOTIFICATION_TEMPLATE");
    }
}
