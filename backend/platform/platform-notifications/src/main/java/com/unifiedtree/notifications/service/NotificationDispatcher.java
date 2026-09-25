package com.unifiedtree.notifications.service;

import com.unifiedtree.notifications.entity.AppNotification;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService.Recipient;
import com.unifiedtree.notifications.prefs.NotificationPreferences;
import com.unifiedtree.notifications.prefs.NotificationPreferences.Delivery;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import com.unifiedtree.notifications.template.NotificationTemplateLookup;
import com.unifiedtree.notifications.template.NotificationTemplateLookup.TemplateText;
import com.unifiedtree.notifications.template.TemplateRenderer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Service;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Sends one catalogued notification to one person, the way they asked for it.
 *
 * <ol>
 *   <li>Looks the recipient up: account, email, company, saved choices.</li>
 *   <li>Applies their choices ({@link NotificationPreferences#decide}).</li>
 *   <li>Picks the wording: the company's active template per channel
 *       (IN_APP → the bell, PUSH → the phone, falling back to the in-app text,
 *       EMAIL → the email, falling back to the in-app text), otherwise the
 *       built-in wording from {@link NotificationEventCatalog}.</li>
 *   <li>Stores the in-app row and queues the push
 *       ({@link AppNotificationService#deliver}), then queues the email on the
 *       notification executor so a slow mail server never holds up a request.</li>
 * </ol>
 *
 * <p>Not transactional on purpose: each step opens its own short transaction
 * with the tenant set, which is what AFTER_COMMIT listeners need (memory:
 * rls-after-commit trap) and keeps at most one extra connection busy.
 */
@Service
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    private final AppNotificationService notifications;
    private final NotificationPreferenceService preferences;
    private final NotificationTemplateLookup templates;
    private final ObjectProvider<NotificationMailTransport> mail;
    private final TaskExecutor executor;

    public NotificationDispatcher(AppNotificationService notifications,
                                  NotificationPreferenceService preferences,
                                  NotificationTemplateLookup templates,
                                  ObjectProvider<NotificationMailTransport> mail,
                                  @Qualifier("notificationExecutor") TaskExecutor executor) {
        this.notifications = notifications;
        this.preferences = preferences;
        this.templates = templates;
        this.mail = mail;
        this.executor = executor;
    }

    /**
     * @param recipientId employee id (or account id for people with no employee record)
     * @param eventKey    a key from {@link NotificationEventCatalog}
     * @param values      placeholder values; missing ones render as nothing
     * @param data        deep-link payload stored on the row and sent with the push
     * @return the stored in-app row, or null when none was stored
     */
    public AppNotification dispatch(UUID tenantId, UUID recipientId, String eventKey,
                                    Map<String, String> values, Map<String, Object> data) {
        if (tenantId == null || recipientId == null) return null;
        EventDef def = NotificationEventCatalog.byKey(eventKey).orElse(null);
        if (def == null) {
            log.warn("Unknown notification event {}; nothing sent to {}", eventKey, recipientId);
            return null;
        }
        Recipient r = preferences.recipient(tenantId, recipientId);
        Delivery d = NotificationPreferences.decide(def, r.prefs());
        if (!d.any()) {
            log.info("Notification {} for {} not sent: switched off in their notification settings", def.key(), recipientId);
            return null;
        }

        // The in-app wording is always needed: push and email fall back to it.
        Set<DeliveryChannel> wanted = EnumSet.of(DeliveryChannel.IN_APP);
        if (d.push()) wanted.add(DeliveryChannel.PUSH);
        if (d.email()) wanted.add(DeliveryChannel.EMAIL);
        Map<DeliveryChannel, TemplateText> found = templates.activeTemplates(tenantId, r.companyId(), def, wanted);

        Text inApp = text(found.get(DeliveryChannel.IN_APP), def.defaultTitle(), def.defaultBody(), values);
        Text push = inApp;
        TemplateText pushTpl = found.get(DeliveryChannel.PUSH);
        if (pushTpl != null) {
            String t = pushTpl.subject() != null && !pushTpl.subject().isBlank()
                    ? TemplateRenderer.renderSubject(pushTpl.subject(), values) : null;
            push = new Text(t == null || t.isBlank() ? inApp.title() : t,
                    TemplateRenderer.render(pushTpl.body(), values).strip());
        }

        AppNotificationType type = def.type() != null ? def.type() : AppNotificationType.GENERAL;
        AppNotification saved = null;
        if (d.inApp() || d.push()) {
            saved = notifications.deliver(tenantId, recipientId, type, inApp.title(), inApp.body(), data,
                    d.inApp(), d.push(), push.title(), push.body());
        }
        if (d.email()) queueEmail(tenantId, def, r, found.get(DeliveryChannel.EMAIL), inApp, values);
        return saved;
    }

    private void queueEmail(UUID tenantId, EventDef def, Recipient r, TemplateText tpl, Text inApp, Map<String, String> values) {
        NotificationMailTransport transport = mail.getIfAvailable();
        if (transport == null || r.email() == null || r.email().isBlank()) {
            log.info("Email for {} skipped: {}", def.key(), transport == null ? "no mail transport" : "recipient has no email");
            return;
        }
        String subject;
        String html;
        if (tpl != null) {
            subject = tpl.subject() != null && !tpl.subject().isBlank()
                    ? TemplateRenderer.renderSubject(tpl.subject(), values) : inApp.title();
            html = TemplateRenderer.renderEmailHtml(tpl.body(), values, def);
        } else {
            subject = inApp.title();
            html = TemplateRenderer.wrap(TemplateRenderer.paragraphs(inApp.body()));
        }
        String to = r.email();
        String finalSubject = subject == null || subject.isBlank() ? def.label() : subject;
        try {
            executor.execute(() -> {
                try {
                    transport.send(to, null, finalSubject, html);
                    log.info("Notification email {} sent (tenant={})", def.key(), tenantId);
                } catch (Exception ex) {
                    log.warn("Notification email {} failed (tenant={}): {}", def.key(), tenantId, ex.getMessage());
                }
            });
        } catch (Exception ex) {
            log.warn("Notification email {} not queued: {}", def.key(), ex.getMessage());
        }
    }

    private static Text text(TemplateText tpl, String defaultTitle, String defaultBody, Map<String, String> values) {
        String titleTpl = tpl != null && tpl.subject() != null && !tpl.subject().isBlank() ? tpl.subject() : defaultTitle;
        String bodyTpl = tpl != null ? tpl.body() : defaultBody;
        String title = TemplateRenderer.renderSubject(titleTpl, values);
        if (title == null || title.isBlank()) title = TemplateRenderer.renderSubject(defaultTitle, values);
        return new Text(title, bodyTpl == null ? null : TemplateRenderer.render(bodyTpl, values).strip());
    }

    private record Text(String title, String body) {}
}
