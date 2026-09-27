package com.hrms.api.expense;

import com.hrms.api.approvals.Money;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.events.ExpenseClaimRaisedForYouEvent;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Map;

/**
 * Tells the employee that HR, finance or an admin raised an expense claim in
 * their name ({@code expense.raised_for_you}, type EXPENSE_CLAIM_RAISED_FOR_YOU),
 * through the existing pipeline: their notification choices, the company's
 * template if it has one, in the app and on the phone.
 *
 * <p>AFTER_COMMIT, so nothing is sent for a claim that rolled back.
 * {@link NotificationDispatcher} opens its own short transactions with the
 * tenant set, which is what an after-commit listener needs.
 */
@Component
public class ExpenseOnBehalfNotifier {

    private static final Logger log = LoggerFactory.getLogger(ExpenseOnBehalfNotifier.class);
    static final String EVENT_KEY = "expense.raised_for_you";

    private final NotificationDispatcher dispatcher;
    private final NotificationLookupService lookup;

    public ExpenseOnBehalfNotifier(NotificationDispatcher dispatcher, NotificationLookupService lookup) {
        this.dispatcher = dispatcher;
        this.lookup = lookup;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRaisedForYou(ExpenseClaimRaisedForYouEvent e) {
        try {
            Map<String, String> values = new HashMap<>();
            values.put("raisedBy", raiserName(e));
            values.put("claimTitle", e.title() == null || e.title().isBlank() ? "an expense claim" : e.title());
            values.put("amount", Money.format(e.currency(), e.amount()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.EXPENSE_CLAIM_RAISED_FOR_YOU.name());
            data.put("expenseClaimId", e.claimId().toString());
            // The mobile app's claims screen, as for EXPENSE_APPROVED / _REJECTED;
            // the web maps the type to its own expenses page.
            data.put("route", "/my-claims");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), EVENT_KEY, values, data);
        } catch (Exception ex) {
            log.warn("Failed to send EXPENSE_CLAIM_RAISED_FOR_YOU for claim {}: {}", e.claimId(), ex.getMessage());
        }
    }

    /** The raiser's name, "HR" when unknown (as advance.raised_for_you does). */
    private String raiserName(ExpenseClaimRaisedForYouEvent e) {
        String name = lookup.employeeName(e.raisedById(), e.tenantId());
        return name == null || name.isBlank() ? "HR" : name;
    }
}
