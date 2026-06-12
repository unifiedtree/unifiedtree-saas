package com.hrms.api.saas;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.unifiedtree.saas.event.WorkspaceCreatedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * Sends the "Your UnifiedTree workspace is ready" welcome email when a new
 * workspace is created via the canonical signup flow
 * ({@link com.unifiedtree.saas.service.SaasService}).
 *
 * <p>Lives in {@code hrms-api} because {@link MailService} is here and
 * {@code platform-saas} does not depend on this module. The decoupling is
 * Spring's {@link org.springframework.context.ApplicationEventPublisher} via
 * {@link WorkspaceCreatedEvent}.
 *
 * <p>This listener mirrors the legacy {@link SaasPlatformService#sendWelcomeEmail}
 * template so the user-facing copy is identical on both code paths. Failures
 * are logged and swallowed — the signup must never fail because of email.
 */
@Component
public class WorkspaceWelcomeEmailListener {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceWelcomeEmailListener.class);

    private final MailService mailService;

    public WorkspaceWelcomeEmailListener(MailService mailService) {
        this.mailService = mailService;
    }

    @EventListener
    @Async
    public void onWorkspaceCreated(WorkspaceCreatedEvent ev) {
        String adminName    = ev.adminName()    == null ? "there"           : ev.adminName();
        String adminEmail   = ev.adminEmail();
        String companyName  = ev.companyName()  == null ? "your company"    : ev.companyName();
        String subdomain    = ev.subdomain();
        String workspaceUrl = ev.workspaceUrl();

        if (adminEmail == null || adminEmail.isBlank()) {
            log.warn("WorkspaceCreatedEvent without adminEmail for subdomain {} - cannot send welcome", subdomain);
            return;
        }

        String subject = "Welcome to UnifiedTree! Your workspace is ready";
        String htmlBody = """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: sans-serif; max-width: 550px; margin: auto; padding: 24px; color: #0F172A; line-height: 1.6; }
                .container { border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px; background-color: #FFFFFF; }
                h1 { font-size: 24px; font-weight: 700; color: #0f6e56; margin-top: 0; }
                .button { display: inline-block; background: #0f6e56; color: #FFFFFF; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 24px 0; }
                .details { background-color: #F1F5F9; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 14px; }
                .details table { width: 100%%; border-collapse: collapse; }
                .details td { padding: 4px 0; }
                .details td.label { font-weight: bold; color: #475569; width: 120px; }
                .footer { color: #64748B; font-size: 13px; margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 16px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Welcome to UnifiedTree!</h1>
                <p>Hi %s,</p>
                <p>Congratulations! Your corporate HRMS & SaaS workspace for <strong>%s</strong> has been successfully created and activated.</p>

                <p>You can access your private workspace and sign in with the password you set during registration at the following URL:</p>

                <div style="text-align: center;">
                  <a href="%s" class="button">Go to Workspace &rarr;</a>
                </div>

                <div class="details">
                  <table>
                    <tr>
                      <td class="label">Workspace URL:</td>
                      <td><a href="%s" style="color: #0f6e56; text-decoration: none; font-weight: bold;">%s</a></td>
                    </tr>
                    <tr>
                      <td class="label">Subdomain:</td>
                      <td>%s</td>
                    </tr>
                    <tr>
                      <td class="label">Admin Email:</td>
                      <td>%s</td>
                    </tr>
                  </table>
                </div>

                <p>Get started by setting up your departments, branches, and inviting your team members to register their profiles and enroll their faces for attendance tracking.</p>

                <p>Best regards,<br>The UnifiedTree Team</p>

                <div class="footer">
                  This is an automated welcome email for your active UnifiedTree SaaS workspace.
                </div>
              </div>
            </body>
            </html>
            """.formatted(adminName, companyName, workspaceUrl, workspaceUrl, workspaceUrl, subdomain, adminEmail);

        try {
            mailService.send(EmailMessage.simple(adminEmail, subject, htmlBody));
            log.info("Workspace welcome email sent to {} for subdomain {}", adminEmail, subdomain);
        } catch (Exception e) {
            log.error("Failed to send workspace welcome email to {} (subdomain {})", adminEmail, subdomain, e);
        }
    }
}
