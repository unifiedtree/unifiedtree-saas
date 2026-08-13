package com.hrms.api.mail;

import com.unifiedtree.saas.event.LeadRequestReceivedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.format.DateTimeFormatter;

/**
 * Emails the sales team when a marketing form is submitted. Listens to
 * {@link LeadRequestReceivedEvent} fired by
 * {@code com.unifiedtree.saas.leads.LeadRequestController}.
 *
 * <p>Lives in {@code com.hrms.api.mail} (alongside {@link MailService}) — a
 * package that is component-scanned on canonical-prod. Same decoupling story
 * as {@link WorkspaceWelcomeEmailListener}: the publisher lives in
 * {@code platform-saas}, which has no dependency on hrms-api, so we bridge via
 * a Spring ApplicationEvent.
 *
 * <p>Failures are logged and swallowed — the DB row + INFO log written by the
 * controller are the canonical trail. A dropped email must never cause a 500
 * for the visitor.
 */
@Component
public class LeadRequestNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(LeadRequestNotificationListener.class);

    /** Where marketing leads are routed. Matches ModuleRequestService.NOTIFY_TO. */
    private static final String NOTIFY_TO = "unifiedtree@gmail.com";

    private final MailService mailService;

    public LeadRequestNotificationListener(MailService mailService) {
        this.mailService = mailService;
    }

    @EventListener
    @Async
    public void onLeadRequest(LeadRequestReceivedEvent ev) {
        try {
            String intentLabel = switch (ev.intent() == null ? "" : ev.intent()) {
                case "demo"  -> "Demo request";
                case "sales" -> "Contact sales";
                default      -> "Website enquiry";
            };
            String subject = intentLabel + ": " + safe(ev.name())
                    + (ev.company() == null || ev.company().isBlank() ? "" : " (" + ev.company() + ")");

            String html = """
                    <h2>%s</h2>
                    <p>A new lead came in from the marketing site.</p>
                    <table cellpadding="6" style="border-collapse:collapse">
                      <tr><td><b>Name</b></td><td>%s</td></tr>
                      <tr><td><b>Work email</b></td><td>%s</td></tr>
                      <tr><td><b>Company</b></td><td>%s</td></tr>
                      <tr><td><b>Company size</b></td><td>%s</td></tr>
                      <tr><td><b>Preferred time</b></td><td>%s</td></tr>
                      <tr><td><b>Timeline</b></td><td>%s</td></tr>
                      <tr><td><b>Notes</b></td><td>%s</td></tr>
                      <tr><td><b>Message</b></td><td>%s</td></tr>
                      <tr><td><b>Received</b></td><td>%s</td></tr>
                      <tr><td><b>IP</b></td><td>%s</td></tr>
                      <tr><td><b>User agent</b></td><td>%s</td></tr>
                      <tr><td><b>Lead id</b></td><td>%s</td></tr>
                    </table>
                    <p>Recorded in <code>platform.lead_requests</code>. Reply directly to the
                       address above — the lead has no auto-response from us.</p>
                    """.formatted(
                            esc(intentLabel),
                            esc(safe(ev.name())),
                            esc(safe(ev.email())),
                            esc(safe(ev.company())),
                            esc(safe(ev.companySize())),
                            esc(safe(ev.preferred())),
                            esc(safe(ev.timeline())),
                            esc(safe(ev.notes())),
                            esc(safe(ev.message())),
                            ev.receivedAt() == null ? "" : DateTimeFormatter.ISO_INSTANT.format(ev.receivedAt()),
                            esc(safe(ev.ipAddress())),
                            esc(safe(ev.userAgent())),
                            ev.leadId() == null ? "" : ev.leadId().toString());

            mailService.send(EmailMessage.simple(NOTIFY_TO, subject, html));
            log.info("Lead-request email sent: intent={} email={} leadId={}",
                    ev.intent(), ev.email(), ev.leadId());
        } catch (Exception e) {
            // Swallow — the controller's DB row + INFO log are the canonical trail.
            log.warn("Failed to send lead-request email (intent={} email={} leadId={})",
                    ev.intent(), ev.email(), ev.leadId(), e);
        }
    }

    private static String safe(String s) {
        return s == null || s.isBlank() ? "—" : s;
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
