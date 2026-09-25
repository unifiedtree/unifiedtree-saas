package com.unifiedtree.notifications.template;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/**
 * Builds the subject and HTML of a notification email: the company's active
 * EMAIL template for the event when there is one, otherwise the sender's
 * built-in email.
 *
 * <p>Templates are plain text. Everything the admin wrote and every value is
 * HTML-escaped ({@link TemplateRenderer#renderEmailHtml}), so a template can't
 * inject markup and neither can a name typed by an employee.
 */
@Service
public class NotificationEmailComposer {

    /** What to send. {@code templated}: an admin's template was used. */
    public record ComposedEmail(String subject, String html, boolean templated) {}

    private final NotificationTemplateLookup lookup;

    public NotificationEmailComposer(NotificationTemplateLookup lookup) {
        this.lookup = lookup;
    }

    /**
     * @param companyId       the recipient's (or the document's) company; null when unknown
     * @param builtInSubject  the sender's own subject; null to use the catalog default
     * @param builtInHtml     the sender's own HTML; null to use the catalog default text
     */
    public ComposedEmail compose(UUID tenantId, UUID companyId, String eventKey, Map<String, String> values,
                                 String builtInSubject, String builtInHtml) {
        NotificationEventCatalog.EventDef def = NotificationEventCatalog.byKey(eventKey).orElse(null);
        if (def == null) return new ComposedEmail(builtInSubject, builtInHtml, false);

        NotificationTemplateLookup.TemplateText tpl = lookup.activeTemplate(tenantId, companyId, def, DeliveryChannel.EMAIL);
        String defaultSubject = builtInSubject != null ? builtInSubject
                : TemplateRenderer.renderSubject(def.defaultEmailSubject(), values);
        if (tpl != null) {
            String subject = tpl.subject() != null && !tpl.subject().isBlank()
                    ? TemplateRenderer.renderSubject(tpl.subject(), values) : defaultSubject;
            if (subject == null || subject.isBlank()) subject = defaultSubject;
            return new ComposedEmail(subject, TemplateRenderer.renderEmailHtml(tpl.body(), values, def), true);
        }
        String html = builtInHtml != null ? builtInHtml
                : TemplateRenderer.renderEmailHtml(def.defaultEmailBody(), values, def);
        return new ComposedEmail(defaultSubject, html, false);
    }
}
