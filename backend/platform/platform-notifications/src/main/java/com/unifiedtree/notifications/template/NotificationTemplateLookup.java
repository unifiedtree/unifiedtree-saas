package com.unifiedtree.notifications.template;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Reads the active notification template(s) an HR admin wrote for an event
 * ({@code notiftemplate_mgmt.notification_templates}).
 *
 * <p>Which template wins: the recipient's company's active template for the
 * event key (or its enum-name alias) and channel, most recently edited first.
 * When the company is unknown (an account with no employee record), the
 * workspace's most recently edited active template for that event is used.
 * A template for another company is never applied to a known company.
 *
 * <p>{@code REQUIRES_NEW} + {@code set_config}: senders call this from
 * AFTER_COMMIT listeners, async mail threads and scheduled jobs, where the
 * thread's connection may have lost its tenant GUC (memory: rls-after-commit
 * trap). A fresh transaction with the tenant set explicitly always sees the
 * tenant's rows. Failures return "no template" so the built-in wording goes out.
 */
@Service
public class NotificationTemplateLookup {

    private static final Logger log = LoggerFactory.getLogger(NotificationTemplateLookup.class);

    /** Subject (title for in-app/push) and body of a stored template. */
    public record TemplateText(String subject, String body) {}

    private final JdbcTemplate jdbc;

    public NotificationTemplateLookup(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Map<DeliveryChannel, TemplateText> activeTemplates(UUID tenantId, UUID companyId,
                                                             NotificationEventCatalog.EventDef def,
                                                             Set<DeliveryChannel> channels) {
        Map<DeliveryChannel, TemplateText> found = new EnumMap<>(DeliveryChannel.class);
        if (tenantId == null || def == null || channels == null || channels.isEmpty()) return found;
        List<DeliveryChannel> wanted = channels.stream().filter(def::templatable).toList();
        if (wanted.isEmpty()) return found;
        try {
            jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
            List<Object> args = new ArrayList<>();
            StringBuilder sql = new StringBuilder("""
                    SELECT channel, subject, body
                      FROM notiftemplate_mgmt.notification_templates
                     WHERE tenant_id = ?
                       AND active = TRUE
                       AND lower(event_key) IN (?, ?)
                    """);
            args.add(tenantId);
            args.add(def.key().toLowerCase(Locale.ROOT));
            args.add(def.alias() == null ? def.key().toLowerCase(Locale.ROOT) : def.alias().toLowerCase(Locale.ROOT));
            sql.append(" AND channel IN (");
            for (int i = 0; i < wanted.size(); i++) {
                sql.append(i == 0 ? "?" : ", ?");
                args.add(wanted.get(i).name());
            }
            sql.append(")");
            if (companyId != null) {
                sql.append(" AND company_id = ?");
                args.add(companyId);
            }
            sql.append(" ORDER BY updated_at DESC, created_at DESC");
            jdbc.query(sql.toString(), rs -> {
                DeliveryChannel c;
                try { c = DeliveryChannel.valueOf(rs.getString("channel")); } catch (IllegalArgumentException e) { return; }
                String body = rs.getString("body");
                if (body == null || body.isBlank() || found.containsKey(c)) return;
                found.put(c, new TemplateText(rs.getString("subject"), body));
            }, args.toArray());
        } catch (Exception ex) {
            log.warn("Template lookup failed for event={} tenant={}: {} (built-in wording used)",
                    def.key(), tenantId, ex.toString());
        }
        return found;
    }

    /** One channel's template, or null. (Transactional itself: the call below is a self-invocation.) */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public TemplateText activeTemplate(UUID tenantId, UUID companyId, NotificationEventCatalog.EventDef def, DeliveryChannel channel) {
        return activeTemplates(tenantId, companyId, def, Set.of(channel)).get(channel);
    }
}
