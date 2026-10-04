package com.hrms.api.audit;

import com.unifiedtree.audit.AuditService;
import com.unifiedtree.auth.session.SessionDevice;
import com.unifiedtree.auth.session.SignedInEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.UUID;

/**
 * Writes every sign-in to the audit log (Settings -> Audit logs says it holds
 * sign-ins, and before this none were ever written: the sign-in endpoints are
 * public, so nothing on that path called the audit service).
 *
 * <p>Runs after the sign-in commits, so a sign-in that failed is never
 * recorded. The row is written under the sign-in's own workspace with the
 * person as the actor (the request has no session of its own yet), as action
 * LOGIN on their user record, with where they signed in from. A failed write
 * is logged and never affects the sign-in.
 */
@Component
public class SignInAuditListener {

    private static final Logger log = LoggerFactory.getLogger(SignInAuditListener.class);

    private final AuditService audit;

    public SignInAuditListener(AuditService audit) {
        this.audit = audit;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onSignedIn(SignedInEvent e) {
        if (e == null || e.tenantId() == null || e.userId() == null) return;
        UUID prevTenant = com.unifiedtree.security.tenant.TenantContext.getTenantId();
        UUID prevCoreTenant = com.hrms.core.tenant.TenantContext.getTenantId();
        // The audit row's connection is scoped by the bound workspace (RLS), so
        // bind the sign-in's own workspace for the write and put back what was there.
        com.unifiedtree.security.tenant.TenantContext.setTenantId(e.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(e.tenantId());
        try {
            audit.recordAs(e.userId(), e.email(), e.ipAddress(), e.userAgent(),
                    "auth", "LOGIN", "USER", e.userId(), summary(e.userAgent()));
        } catch (RuntimeException ex) {
            log.warn("sign-in of user {} not written to the audit log: {}", e.userId(), ex.toString());
        } finally {
            com.unifiedtree.security.tenant.TenantContext.setTenantId(prevTenant);
            com.hrms.core.tenant.TenantContext.setTenantId(prevCoreTenant);
        }
    }

    /** "Signed in on Chrome on Windows", or just "Signed in" when the device is unknown. */
    static String summary(String userAgent) {
        String device = SessionDevice.describe(userAgent);
        return "Unknown device".equals(device) ? "Signed in" : "Signed in on " + device;
    }
}
