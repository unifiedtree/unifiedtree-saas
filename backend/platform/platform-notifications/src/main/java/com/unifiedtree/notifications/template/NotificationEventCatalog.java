package com.unifiedtree.notifications.template;

import com.unifiedtree.notifications.enums.AppNotificationType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Every notification the platform sends, in one list.
 *
 * <p>For each event this says:
 * <ul>
 *   <li>its <b>event key</b> — what a notification template's {@code event_key}
 *       must be for the template to be used (the {@link AppNotificationType}
 *       name, e.g. {@code LEAVE_APPROVED}, is accepted as an alias);</li>
 *   <li>who gets it, in plain English, and which channels it can use;</li>
 *   <li>the {@code {{placeholders}}} a template may use;</li>
 *   <li>the built-in wording. Senders render this default when the company has
 *       no active template, so it IS the text people receive today.</li>
 *   <li>whether it is <b>essential</b>: security, access, billing and documents
 *       HR sends on purpose always go out, whatever the person's preferences.</li>
 * </ul>
 *
 * <p>Every {@link AppNotificationType} must have an entry (see
 * {@link #forType}); {@code NotificationEventCatalogTest} fails the build when a
 * new type is added without one.
 *
 * <p>Served to the web app by {@code GET /v1/notiftemplate/events} (template
 * editor) and {@code GET /v1/me/notification-preferences} (per-user choices).
 */
public final class NotificationEventCatalog {

    /** A {{name}} a template may use. {@code link}: rendered as a clickable link in email. {@code html}: value is already-safe HTML. */
    public record Placeholder(String name, String description, boolean link, boolean html) {}

    /**
     * One event.
     *
     * @param channels          channels this event is delivered on
     * @param templateChannels  channels an admin may write a template for (empty: wording is fixed)
     * @param essential         always delivered; preferences cannot switch it off
     * @param external          goes to someone outside the workspace (a candidate); no preferences apply
     * @param emailByDefault    for events that can also email: whether the email goes out unless the person opts out
     */
    public record EventDef(
            String key,
            AppNotificationType type,
            String group,
            String label,
            String audience,
            String description,
            Set<DeliveryChannel> channels,
            Set<DeliveryChannel> templateChannels,
            boolean essential,
            boolean external,
            boolean emailByDefault,
            List<Placeholder> placeholders,
            String defaultTitle,
            String defaultBody,
            String defaultEmailSubject,
            String defaultEmailBody) {

        public boolean has(DeliveryChannel c) { return channels.contains(c); }

        public boolean templatable(DeliveryChannel c) { return templateChannels.contains(c); }

        /** The alias accepted for this key in stored templates (the enum name), or null. */
        public String alias() { return type == null ? null : type.name(); }

        public Placeholder placeholder(String name) {
            for (Placeholder p : placeholders) if (p.name().equals(name)) return p;
            return null;
        }

        /** Default subject + body for a channel (IN_APP/PUSH use the title as the subject). */
        public String defaultSubject(DeliveryChannel c) {
            return c == DeliveryChannel.EMAIL ? defaultEmailSubject : defaultTitle;
        }

        public String defaultBodyFor(DeliveryChannel c) {
            return c == DeliveryChannel.EMAIL ? defaultEmailBody : defaultBody;
        }
    }

    // ── placeholders used by several events ──────────────────────────────────
    private static final Placeholder EMPLOYEE_NAME = ph("employeeName", "Full name of the person the notification is about");
    private static final Placeholder LEAVE_TYPE = ph("leaveType", "Leave type, for example Casual Leave");
    private static final Placeholder START_DATE = ph("startDate", "First day, for example 5 Jul 2026");
    private static final Placeholder END_DATE = ph("endDate", "Last day, for example 7 Jul 2026");
    private static final Placeholder REASON = ph("reason", "The approver's reason, when they gave one (otherwise empty)");
    private static final Placeholder REASON_TEXT = ph("reasonText", "The reason as a sentence (\" Reason: …\"), or nothing when none was given");
    private static final Placeholder DATES = ph("dates", "\"on 5 Jul 2026\" for one day, or \"from 5 Jul 2026 to 7 Jul 2026\"");
    private static final Placeholder DATE = ph("date", "The day, for example 5 Jul 2026");
    private static final Placeholder SHIFT_NAME = ph("shiftName", "Name of the requested shift");
    private static final Placeholder FROM_DATE = ph("fromDate", "The day the change starts (empty when none was given)");
    private static final Placeholder FROM_DATE_TEXT = ph("fromDateText", "\" from 5 Jul 2026\", or nothing when no start day was given");
    private static final Placeholder AMOUNT = ph("amount", "The amount with its currency, for example ₹1500");
    private static final Placeholder CLAIM_TITLE = ph("claimTitle", "Title of the expense claim");
    private static final Placeholder HOURS = ph("hours", "Overtime hours, for example 2.5h");
    private static final Placeholder DOCUMENT_TYPE = ph("documentType", "Document type, for example PAN card");
    private static final Placeholder WORKSPACE_NAME = ph("workspaceName", "Your workspace's name");
    private static final Placeholder FIRST_NAME = ph("firstName", "The recipient's first name");
    private static final Placeholder DEPARTMENT = ph("department", "Their department (empty when they have none)");
    private static final Placeholder DEPARTMENT_TEXT = ph("departmentText", "\", in Sales\" style text, or nothing when they have no department");

    private static final Map<String, EventDef> BY_KEY = new LinkedHashMap<>();
    private static final Map<AppNotificationType, EventDef> BY_TYPE = new EnumMap<>(AppNotificationType.class);

    static {
        // ── Leave ────────────────────────────────────────────────────────────
        add(inApp("leave.submitted", AppNotificationType.LEAVE_SUBMITTED, "Leave", "Leave request submitted", "Approver",
                "Sent to the approver when someone applies for leave.",
                "New leave request", "{{employeeName}} requested {{leaveType}} from {{startDate}} to {{endDate}}",
                EMPLOYEE_NAME, LEAVE_TYPE, START_DATE, END_DATE));
        add(inApp("leave.approved", AppNotificationType.LEAVE_APPROVED, "Leave", "Leave approved", "Employee",
                "Sent to the employee when their leave is approved.",
                "Leave approved", "Your {{leaveType}} from {{startDate}} to {{endDate}} has been approved.",
                LEAVE_TYPE, START_DATE, END_DATE));
        add(inApp("leave.rejected", AppNotificationType.LEAVE_REJECTED, "Leave", "Leave rejected", "Employee",
                "Sent to the employee when their leave is rejected.",
                "Leave rejected", "Your {{leaveType}} from {{startDate}} to {{endDate}} has been rejected.{{reasonText}}",
                LEAVE_TYPE, START_DATE, END_DATE, REASON, REASON_TEXT));
        add(inApp("leave.cancelled", AppNotificationType.LEAVE_CANCELLED, "Leave", "Leave request cancelled", "Approver",
                "Sent to the approver when someone cancels their leave request.",
                "Leave request cancelled", "{{employeeName}} cancelled their {{leaveType}} from {{startDate}} to {{endDate}}.",
                EMPLOYEE_NAME, LEAVE_TYPE, START_DATE, END_DATE));

        // ── Work from home ───────────────────────────────────────────────────
        add(inApp("wfh.submitted", AppNotificationType.WFH_SUBMITTED, "Work from home", "Work-from-home request submitted", "Approver",
                "Sent to the approver when someone asks to work from home.",
                "New WFH request", "{{employeeName}} requested to work from home {{dates}}.",
                EMPLOYEE_NAME, DATES));
        add(inApp("wfh.approved", AppNotificationType.WFH_APPROVED, "Work from home", "Work from home approved", "Employee",
                "Sent to the employee when their work-from-home request is approved.",
                "WFH approved", "Your work-from-home request {{dates}} has been approved.",
                DATES));
        add(inApp("wfh.rejected", AppNotificationType.WFH_REJECTED, "Work from home", "Work from home rejected", "Employee",
                "Sent to the employee when their work-from-home request is rejected.",
                "WFH rejected", "Your work-from-home request {{dates}} has been rejected.{{reasonText}}",
                DATES, REASON, REASON_TEXT));
        add(inApp("wfh.cancelled", AppNotificationType.WFH_CANCELLED, "Work from home", "Work-from-home request cancelled", "Approver",
                "Sent to the approver when someone cancels a work-from-home request.",
                "WFH request cancelled", "{{employeeName}} cancelled their work-from-home request {{dates}}.",
                EMPLOYEE_NAME, DATES));

        // ── Attendance ───────────────────────────────────────────────────────
        add(inApp("attendance.correction_submitted", AppNotificationType.CORRECTION_SUBMITTED, "Attendance", "Attendance correction requested", "Approver",
                "Sent to the approver when someone asks to correct their attendance.",
                "New correction request", "{{employeeName}} requested an attendance correction for {{date}}.",
                EMPLOYEE_NAME, DATE));
        add(inApp("attendance.correction_approved", AppNotificationType.CORRECTION_APPROVED, "Attendance", "Attendance correction approved", "Employee",
                "Sent to the employee when their attendance correction is approved.",
                "Correction approved", "Your attendance correction for {{date}} has been approved.",
                DATE));
        add(inApp("attendance.correction_rejected", AppNotificationType.CORRECTION_REJECTED, "Attendance", "Attendance correction rejected", "Employee",
                "Sent to the employee when their attendance correction is rejected.",
                "Correction rejected", "Your attendance correction for {{date}} has been rejected.{{reasonText}}",
                DATE, REASON, REASON_TEXT));
        add(inApp("attendance.overtime_approved", AppNotificationType.OVERTIME_APPROVED, "Attendance", "Overtime approved", "Employee",
                "Sent to the employee when their overtime is approved. Approval records it; it isn't paid.",
                "Overtime approved", "Your overtime of {{hours}} on {{date}} was approved. Recorded, not paid.",
                HOURS, DATE));
        add(inApp("attendance.overtime_rejected", AppNotificationType.OVERTIME_REJECTED, "Attendance", "Overtime rejected", "Employee",
                "Sent to the employee when their overtime is rejected.",
                "Overtime rejected", "Your overtime of {{hours}} on {{date}} was rejected.{{reasonText}}",
                HOURS, DATE, REASON, REASON_TEXT));
        add(inApp("attendance.face_enrolled", AppNotificationType.FACE_ENROLLMENT_COMPLETE, "Attendance", "Face enrolment complete", "Employee",
                "Sent to the employee when their face is enrolled for face punch-in.",
                "Face enrolment complete", "You can now punch in with your face."));
        add(inApp("attendance.face_enrolment_failed", AppNotificationType.FACE_ENROLLMENT_FAILED, "Attendance", "Face enrolment failed", "Employee",
                "Sent to the employee when their face enrolment fails.",
                "Face enrolment failed", "{{reason}}",
                ph("reason", "Why it failed, or a request to ask their manager to reset the enrolment")));

        // ── Shifts ───────────────────────────────────────────────────────────
        add(inApp("shift.change_submitted", AppNotificationType.SHIFT_CHANGE_SUBMITTED, "Shifts", "Shift change requested", "Approver",
                "Sent to the approver when someone asks to move to another shift.",
                "New shift change request", "{{employeeName}} requested to move to the {{shiftName}} shift{{fromDateText}}.",
                EMPLOYEE_NAME, SHIFT_NAME, FROM_DATE, FROM_DATE_TEXT));
        add(inApp("shift.change_approved", AppNotificationType.SHIFT_CHANGE_APPROVED, "Shifts", "Shift change approved", "Employee",
                "Sent to the employee when their shift change is approved.",
                "Shift change approved", "Your shift changes to {{shiftName}}{{fromDateText}}.",
                SHIFT_NAME, FROM_DATE, FROM_DATE_TEXT));
        add(inApp("shift.change_rejected", AppNotificationType.SHIFT_CHANGE_REJECTED, "Shifts", "Shift change rejected", "Employee",
                "Sent to the employee when their shift change is rejected.",
                "Shift change rejected", "Your request to move to {{shiftName}} was rejected.{{reasonText}}",
                SHIFT_NAME, REASON, REASON_TEXT));

        // ── Expenses and advances ────────────────────────────────────────────
        add(inApp("expense.submitted", AppNotificationType.EXPENSE_SUBMITTED, "Expenses and advances", "Expense claim submitted", "Approver",
                "Sent to the approver when someone submits an expense claim.",
                "New expense claim to review", "{{employeeName}} submitted an expense claim for {{amount}}: {{claimTitle}}.",
                EMPLOYEE_NAME, AMOUNT, CLAIM_TITLE));
        add(inApp("expense.approved", AppNotificationType.EXPENSE_APPROVED, "Expenses and advances", "Expense claim approved", "Employee",
                "Sent to the employee when their expense claim is approved.",
                "Expense claim approved", "Your claim {{claimTitle}} ({{amount}}) was approved.",
                CLAIM_TITLE, AMOUNT));
        add(inApp("expense.rejected", AppNotificationType.EXPENSE_REJECTED, "Expenses and advances", "Expense claim rejected", "Employee",
                "Sent to the employee when their expense claim is rejected.",
                "Expense claim rejected", "Your claim {{claimTitle}} ({{amount}}) was rejected.{{reasonText}}",
                CLAIM_TITLE, AMOUNT, REASON, REASON_TEXT));
        add(inApp("advance.submitted", AppNotificationType.ADVANCE_SUBMITTED, "Expenses and advances", "Salary advance requested", "Approver",
                "Sent to the approver when someone requests a salary advance.",
                "New advance request to review", "{{employeeName}} requested a salary advance of {{amount}}.",
                EMPLOYEE_NAME, AMOUNT));
        add(inApp("advance.approved", AppNotificationType.ADVANCE_APPROVED, "Expenses and advances", "Salary advance approved", "Employee",
                "Sent to the employee when their salary advance is approved.",
                "Advance request approved", "Your advance request of {{amount}} was approved.",
                AMOUNT));
        add(inApp("advance.rejected", AppNotificationType.ADVANCE_REJECTED, "Expenses and advances", "Salary advance rejected", "Employee",
                "Sent to the employee when their salary advance is rejected.",
                "Advance request rejected", "Your advance request of {{amount}} was rejected.{{reasonText}}",
                AMOUNT, REASON, REASON_TEXT));

        // ── Documents ────────────────────────────────────────────────────────
        add(inApp("document.uploaded", AppNotificationType.DOCUMENT_UPLOADED, "Documents", "Document uploaded for checking", "HR",
                "Sent to HR when an employee uploads a document that needs checking.",
                "New document to verify", "{{employeeName}} uploaded their {{documentType}}. Please review.",
                EMPLOYEE_NAME, DOCUMENT_TYPE));
        add(inApp("document.verified", AppNotificationType.DOCUMENT_VERIFIED, "Documents", "Document verified", "Employee",
                "Sent to the employee when HR verifies their document.",
                "Document verified", "Your {{documentType}} has been verified by HR.",
                DOCUMENT_TYPE));
        add(inApp("document.rejected", AppNotificationType.DOCUMENT_REJECTED, "Documents", "Document rejected", "Employee",
                "Sent to the employee when HR rejects their document and asks for a new one.",
                "Document needs re-upload", "Your {{documentType}} was rejected.{{reasonText}} Please re-upload.",
                DOCUMENT_TYPE, REASON, REASON_TEXT));

        // ── People ───────────────────────────────────────────────────────────
        add(inApp("people.welcome", AppNotificationType.WELCOME, "People", "Welcome", "Employee",
                "Sent to a new employee when they activate their account.",
                "Welcome to {{workspaceName}}", "Your account is active. Punch in, apply for leave, and track attendance right here.",
                WORKSPACE_NAME));
        add(inApp("people.birthday", null, "People", "Birthday greeting", "Employee",
                "Sent to the person on their birthday.",
                "Happy birthday, {{firstName}}!", "Everyone at {{teamName}} wishes you a great day.",
                FIRST_NAME, ph("teamName", "Their department, or the workspace name when they have none")));
        add(inApp("people.birthday_heads_up", null, "People", "Colleague's birthday", "Manager and HR",
                "Sent to the person's manager and HR on their birthday.",
                "It's {{employeeName}}'s birthday", "Today{{departmentText}}.",
                EMPLOYEE_NAME, DEPARTMENT, DEPARTMENT_TEXT));
        add(inApp("people.work_anniversary", null, "People", "Work anniversary greeting", "Employee",
                "Sent to the person on their work anniversary.",
                "Happy work anniversary!", "{{yearsWithUs}} with us today. Thank you for everything.",
                ph("years", "Completed years, for example 3"),
                ph("yearsWithUs", "\"One year\" or \"3 years\"")));
        add(inApp("people.work_anniversary_heads_up", null, "People", "Colleague's work anniversary", "Manager and HR",
                "Sent to the person's manager and HR on their work anniversary.",
                "{{employeeName}} completes {{yearsText}}", "Work anniversary today{{departmentText}}.",
                EMPLOYEE_NAME, ph("years", "Completed years, for example 3"), ph("yearsText", "\"1 year\" or \"3 years\""),
                DEPARTMENT, DEPARTMENT_TEXT));
        add(email("people.probation_reminder", "People", "Probation ending soon", "Manager and HR",
                "Emailed to the person's manager and HR a few days before their probation ends.",
                false, false,
                "Probation ending: {{employeeName}} ({{daysRemaining}} days)",
                "{{employeeName}}'s probation period ends on {{endDate}} ({{daysRemaining}} days from today).\n\n"
                        + "Please review it and confirm them as permanent, extend the probation, or start an exit.\n\n"
                        + "Open the employee record: {{recordLink}}",
                EMPLOYEE_NAME, ph("endDate", "The day probation ends, for example 2026-10-01"),
                ph("daysRemaining", "Days left, for example 7"), link("recordLink", "Link to the employee's record"),
                WORKSPACE_NAME));

        // ── Account (always sent) ────────────────────────────────────────────
        add(email("account.invitation", "Account", "Invitation to join", "New member",
                "Emailed when someone is invited to the workspace. Always sent: it's how they set their password.",
                true, false,
                "Welcome to {{workspaceName}}",
                "Hi {{firstName}},\n\nYou've been added to {{workspaceName}}. Use the link below to set your password and sign in.\n\n"
                        + "{{inviteLink}}\n\nThis link expires in {{expiresIn}}. If you weren't expecting this, you can ignore this email.",
                FIRST_NAME, WORKSPACE_NAME, link("inviteLink", "The link that sets their password"),
                ph("expiresIn", "How long the link works, for example 72 hours")));
        add(email("account.password_reset", "Account", "Password reset", "The person who asked",
                "Emailed when someone asks to reset their password. Always sent: it's how people get back into their account.",
                true, false,
                "Reset your {{workspaceName}} password",
                "Someone asked to reset the password for your {{workspaceName}} account. Use the link below to set a new one.\n\n"
                        + "{{resetLink}}\n\nThis link expires in {{expiresIn}}. If you didn't ask for this, you can ignore this email.",
                WORKSPACE_NAME, link("resetLink", "The link that sets a new password"),
                ph("expiresIn", "How long the link works, for example 24 hours")));

        // ── Hiring (to candidates) ───────────────────────────────────────────
        add(email("hiring.offer", "Hiring", "Offer to a candidate", "Candidate",
                "Emailed to a candidate when HR sends their offer. Your message comes first; the offer follows and is attached as a PDF.",
                true, true,
                "Employment offer",
                "Dear {{candidateName}},\n\nWe are pleased to offer you the position of {{roleTitle}} at {{companyName}}. "
                        + "The details are below and attached as a PDF.",
                ph("candidateName", "The candidate's name"), ph("roleTitle", "The position offered"),
                ph("companyName", "Your company's legal name"), ph("joiningDate", "Proposed joining date (empty when not set)"),
                ph("offeredCtc", "Annual offered CTC in INR")));

        // ── Letters (always sent: HR chose to send them) ─────────────────────
        add(email("letters.letter", "Letters", "Letter emailed to an employee", "Employee",
                "Emailed when HR sends a generated letter. Always sent: HR chose to send it. The letter follows your message and is attached as a PDF.",
                true, false,
                "{{letterSubject}}",
                "Hi {{firstName}},\n\nPlease find your {{letterSubject}} below. It's also attached as a PDF.",
                FIRST_NAME, EMPLOYEE_NAME, ph("letterSubject", "The letter's subject"),
                ph("companyName", "The employee's company")));
        add(email("letters.distribution", "Letters", "Document sent to many employees", "Employee",
                "Emailed to each person when HR sends a document to a group. Always sent: HR chose to send it. A subject typed on the distribution wins over this one.",
                true, false,
                "{{firstName}}, you have a new document",
                "Hi {{firstName}},\n\n{{message}}\n\nPlease find your document attached.",
                FIRST_NAME, EMPLOYEE_NAME, ph("documentTitle", "The distribution's title"),
                new Placeholder("message", "The message HR typed on the distribution", false, true)));

        // ── Billing (always sent, fixed wording) ─────────────────────────────
        add(fixed("billing.payment_failed", AppNotificationType.SUBSCRIPTION_HALTED, "Billing", "Autopay payment failed", "Admins",
                "Sent to admins when an autopay charge fails. Always sent: the workspace locks if it isn't fixed.",
                EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH, DeliveryChannel.EMAIL),
                "Payment failed — please update your card", "Your autopay charge didn't go through. Access continues until the grace date."));
        add(fixed("billing.seat_limit", AppNotificationType.BILLING_OVER_CAP, "Billing", "More employees than paid seats", "Admins",
                "Sent to admins when active employees exceed the paid seats. Always sent: adding people is blocked until it's fixed.",
                EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH),
                "Seat cap exceeded", "You have more active employees than paid seats. Adding a new employee is blocked until you cover the extras."));
        add(fixed("billing.trial_ending", AppNotificationType.TRIAL_ENDING_SOON, "Billing", "Free trial ending", "Admins",
                "Warned admins before a free trial ended. Not sent at the moment: trials without autopay were retired.",
                EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH, DeliveryChannel.EMAIL),
                "Your free trial ends soon", "Subscribe now to keep using your workspace without interruption."));
        add(fixed("billing.trial_ended", AppNotificationType.TRIAL_EXPIRED, "Billing", "Free trial ended", "Admins",
                "Told admins a free trial had ended. Not sent at the moment: trials without autopay were retired.",
                EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH, DeliveryChannel.EMAIL),
                "Your free trial has ended", "Your workspace is still active. Please subscribe to continue."));

        // ── Anything else ────────────────────────────────────────────────────
        add(new EventDef("general", AppNotificationType.GENERAL, "Other", "Other alerts", "Anyone",
                "Any other alert that has no setting of its own.",
                EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH), EnumSet.noneOf(DeliveryChannel.class),
                false, false, false, List.of(), "Update", "You have a new update.", null, null));
    }

    private NotificationEventCatalog() {}

    // ── lookups ──────────────────────────────────────────────────────────────

    /** Every event, in display order. */
    public static List<EventDef> all() {
        return Collections.unmodifiableList(new ArrayList<>(BY_KEY.values()));
    }

    /**
     * Finds an event by its key, ignoring case. The {@link AppNotificationType}
     * name (e.g. {@code LEAVE_APPROVED}) is accepted too, so templates saved
     * with that spelling before the catalog existed still match.
     */
    public static Optional<EventDef> byKey(String key) {
        if (key == null || key.isBlank()) return Optional.empty();
        String k = key.trim();
        EventDef d = BY_KEY.get(k.toLowerCase(Locale.ROOT));
        if (d != null) return Optional.of(d);
        for (EventDef e : BY_KEY.values()) {
            if (e.alias() != null && e.alias().equalsIgnoreCase(k)) return Optional.of(e);
        }
        return Optional.empty();
    }

    /** The event a notification type belongs to; never null (falls back to "general"). */
    public static EventDef forType(AppNotificationType type) {
        EventDef d = type == null ? null : BY_TYPE.get(type);
        return d != null ? d : BY_KEY.get("general");
    }

    /** True when {@code type} has its own entry (not just the "general" fallback). */
    public static boolean covers(AppNotificationType type) {
        return BY_TYPE.containsKey(type);
    }

    // ── builders ─────────────────────────────────────────────────────────────

    private static void add(EventDef d) {
        if (BY_KEY.put(d.key(), d) != null) throw new IllegalStateException("Duplicate notification event key " + d.key());
        // Only the first event of a type is its canonical entry (people.* share GENERAL and have none).
        if (d.type() != null) BY_TYPE.putIfAbsent(d.type(), d);
    }

    private static Placeholder ph(String name, String description) {
        return new Placeholder(name, description, false, false);
    }

    private static Placeholder link(String name, String description) {
        return new Placeholder(name, description, true, false);
    }

    /** In the app + push; can also email the person if they opt in (email is off by default). */
    private static EventDef inApp(String key, AppNotificationType type, String group, String label, String audience,
                                  String description, String title, String body, Placeholder... placeholders) {
        EnumSet<DeliveryChannel> all = EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH, DeliveryChannel.EMAIL);
        return new EventDef(key, type, group, label, audience, description, all, EnumSet.copyOf(all),
                false, false, false, List.of(placeholders), title, body, title, body);
    }

    /** Email only. */
    private static EventDef email(String key, String group, String label, String audience, String description,
                                  boolean essential, boolean external, String subject, String body, Placeholder... placeholders) {
        EnumSet<DeliveryChannel> ch = EnumSet.of(DeliveryChannel.EMAIL);
        return new EventDef(key, null, group, label, audience, description, ch, EnumSet.copyOf(ch),
                essential, external, true, List.of(placeholders), subject, body, subject, body);
    }

    /** Always sent, wording fixed by the sender (not templatable). */
    private static EventDef fixed(String key, AppNotificationType type, String group, String label, String audience,
                                  String description, EnumSet<DeliveryChannel> channels, String title, String body) {
        return new EventDef(key, type, group, label, audience, description, channels, EnumSet.noneOf(DeliveryChannel.class),
                true, false, true, List.of(), title, body, title, body);
    }
}
