package com.hrms.notification.service;

import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

@Service
public class LeaveEmailService {

    private static final Logger log = LoggerFactory.getLogger(LeaveEmailService.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("dd MMM yyyy");

    private final JavaMailSender mailSender;
    private final String fromEmail;
    private final String fromName;

    public LeaveEmailService(
            JavaMailSender mailSender,
            @Value("${unifiedtree.mail.from.email:noreply@unifiedtree.com}") String fromEmail,
            @Value("${unifiedtree.mail.from.name:UnifiedTree}") String fromName) {
        this.mailSender = mailSender;
        this.fromEmail = fromEmail;
        this.fromName = fromName;
    }

    @Async("notificationExecutor")
    public void sendLeaveRequested(
            String approverEmail, String approverName,
            String employeeName,
            String leaveTypeName,
            LocalDate startDate, LocalDate endDate,
            double totalDays,
            String workspaceUrl) {

        if (approverEmail == null) return;

        String subject = "Leave Request Submitted – " + employeeName;
        String html = """
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
                  <div style="background:#1a7f5a;padding:20px 24px;border-radius:8px 8px 0 0">
                    <h2 style="color:#fff;margin:0;font-size:20px">Leave Request Submitted</h2>
                  </div>
                  <div style="background:#f9f9f9;padding:24px;border:1px solid #e5e5e5;border-radius:0 0 8px 8px">
                    <p style="margin-top:0">Hi %s,</p>
                    <p><strong>%s</strong> has submitted a leave request requiring your approval.</p>
                    <table style="width:100%%;border-collapse:collapse;margin:16px 0">
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600;width:40%%">Leave Type</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">From</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">To</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">Duration</td>
                        <td style="padding:10px 14px">%.1f day(s)</td>
                      </tr>
                    </table>
                    <p>Please log in to review and take action.</p>
                    <a href="%s/hrms/leave/approvals"
                       style="display:inline-block;background:#1a7f5a;color:#fff;padding:10px 20px;
                              border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">
                      Review Request
                    </a>
                    <p style="margin-top:24px;font-size:12px;color:#888">
                      UnifiedTree HRMS · This is an automated notification.
                    </p>
                  </div>
                </div>
                """.formatted(
                approverName != null ? approverName : "Manager",
                employeeName,
                leaveTypeName,
                startDate != null ? startDate.format(DATE_FMT) : "-",
                endDate != null ? endDate.format(DATE_FMT) : "-",
                totalDays,
                workspaceUrl != null ? workspaceUrl : "");

        send(approverEmail, subject, html);
    }

    @Async("notificationExecutor")
    public void sendLeaveApproved(
            String employeeEmail, String employeeName,
            String leaveTypeName,
            LocalDate startDate, LocalDate endDate,
            String workspaceUrl) {

        if (employeeEmail == null) return;

        String subject = "Leave Request Approved";
        String html = """
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
                  <div style="background:#1a7f5a;padding:20px 24px;border-radius:8px 8px 0 0">
                    <h2 style="color:#fff;margin:0;font-size:20px">Leave Approved ✓</h2>
                  </div>
                  <div style="background:#f9f9f9;padding:24px;border:1px solid #e5e5e5;border-radius:0 0 8px 8px">
                    <p style="margin-top:0">Hi %s,</p>
                    <p>Your leave request has been <strong style="color:#1a7f5a">approved</strong>.</p>
                    <table style="width:100%%;border-collapse:collapse;margin:16px 0">
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600;width:40%%">Leave Type</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">From</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">To</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                    </table>
                    <p style="margin-top:24px;font-size:12px;color:#888">
                      UnifiedTree HRMS · This is an automated notification.
                    </p>
                  </div>
                </div>
                """.formatted(
                employeeName != null ? employeeName : "there",
                leaveTypeName,
                startDate != null ? startDate.format(DATE_FMT) : "-",
                endDate != null ? endDate.format(DATE_FMT) : "-");

        send(employeeEmail, subject, html);
    }

    @Async("notificationExecutor")
    public void sendLeaveRejected(
            String employeeEmail, String employeeName,
            String leaveTypeName,
            LocalDate startDate, LocalDate endDate,
            String reason,
            String workspaceUrl) {

        if (employeeEmail == null) return;

        String subject = "Leave Request Rejected";
        String reasonRow = reason != null && !reason.isBlank()
                ? "<tr style=\"background:#fff5f5;border:1px solid #e5e5e5\">"
                  + "<td style=\"padding:10px 14px;font-weight:600;width:40%\">Reason</td>"
                  + "<td style=\"padding:10px 14px;color:#c0392b\">" + reason + "</td></tr>"
                : "";
        String html = """
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
                  <div style="background:#c0392b;padding:20px 24px;border-radius:8px 8px 0 0">
                    <h2 style="color:#fff;margin:0;font-size:20px">Leave Request Rejected</h2>
                  </div>
                  <div style="background:#f9f9f9;padding:24px;border:1px solid #e5e5e5;border-radius:0 0 8px 8px">
                    <p style="margin-top:0">Hi %s,</p>
                    <p>Unfortunately your leave request has been <strong style="color:#c0392b">rejected</strong>.</p>
                    <table style="width:100%%;border-collapse:collapse;margin:16px 0">
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600;width:40%%">Leave Type</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">From</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">To</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      %s
                    </table>
                    <p>Please contact your manager if you have questions.</p>
                    <p style="margin-top:24px;font-size:12px;color:#888">
                      UnifiedTree HRMS · This is an automated notification.
                    </p>
                  </div>
                </div>
                """.formatted(
                employeeName != null ? employeeName : "there",
                leaveTypeName,
                startDate != null ? startDate.format(DATE_FMT) : "-",
                endDate != null ? endDate.format(DATE_FMT) : "-",
                reasonRow);

        send(employeeEmail, subject, html);
    }

    @Async("notificationExecutor")
    public void sendLeaveCancelled(
            String employeeEmail, String employeeName,
            String approverEmail, String approverName,
            String leaveTypeName,
            LocalDate startDate, LocalDate endDate,
            String cancellationReason) {

        String subject = "Leave Request Cancelled – " + leaveTypeName;
        String html = """
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
                  <div style="background:#7f8c8d;padding:20px 24px;border-radius:8px 8px 0 0">
                    <h2 style="color:#fff;margin:0;font-size:20px">Leave Cancelled</h2>
                  </div>
                  <div style="background:#f9f9f9;padding:24px;border:1px solid #e5e5e5;border-radius:0 0 8px 8px">
                    <p style="margin-top:0">Hi %s,</p>
                    <p>The following leave request has been <strong>cancelled</strong>.</p>
                    <table style="width:100%%;border-collapse:collapse;margin:16px 0">
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600;width:40%%">Employee</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">Leave Type</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#fff;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">From</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                      <tr style="background:#f0f0f0;border:1px solid #e5e5e5">
                        <td style="padding:10px 14px;font-weight:600">To</td>
                        <td style="padding:10px 14px">%s</td>
                      </tr>
                    </table>
                    <p style="margin-top:24px;font-size:12px;color:#888">
                      UnifiedTree HRMS · This is an automated notification.
                    </p>
                  </div>
                </div>
                """;

        if (employeeEmail != null) {
            send(employeeEmail, subject,
                    html.formatted("there", employeeName,
                            leaveTypeName,
                            startDate != null ? startDate.format(DATE_FMT) : "-",
                            endDate != null ? endDate.format(DATE_FMT) : "-"));
        }
        if (approverEmail != null) {
            send(approverEmail, subject,
                    html.formatted(approverName != null ? approverName : "Manager",
                            employeeName,
                            leaveTypeName,
                            startDate != null ? startDate.format(DATE_FMT) : "-",
                            endDate != null ? endDate.format(DATE_FMT) : "-"));
        }
    }

    private void send(String to, String subject, String html) {
        try {
            MimeMessage msg = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, false, "UTF-8");
            helper.setFrom(fromEmail, fromName);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(msg);
            log.debug("Leave email sent to {} subject='{}'", to, subject);
        } catch (Exception e) {
            log.error("Failed to send leave email to {}: {}", to, e.getMessage());
        }
    }
}
