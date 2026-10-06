package com.unifiedtree.saas.admin.support;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The one way a platform-operator request reads another workspace's
 * row-level-secured data (org.companies, hrms.employees, rbac.user_*, audit.events).
 *
 * <p>Those tables are FORCE ROW LEVEL SECURITY on {@code tenant_id = current_tenant_id()},
 * and {@code current_tenant_id()} is whatever {@code TenantAwareDataSource} put in
 * {@code SET LOCAL app.tenant_id} when the connection was taken. An operator's own
 * request is bound to the platform tenant, so it sees none of a workspace's rows.
 * This does what the nightly jobs do (ShiftChangeRequestExpiryJob): bind the target
 * workspace, then open a NEW transaction so the connection is taken with that
 * workspace's {@code SET LOCAL}. Nothing about RLS is loosened, and no role with
 * BYPASSRLS is involved: inside the callback the database enforces exactly the
 * isolation it enforces for that workspace's own users.
 *
 * <p>Read-only by construction (the transaction is read-only), and the caller's
 * own tenant and user are restored afterwards, so the rest of the request — and
 * any audit written after it — stays attributed to the operator.
 */
@Component
public class TenantScopedReader {

    private final TransactionTemplate readOnlyNewTx;
    private final TransactionTemplate writeNewTx;

    public TenantScopedReader(PlatformTransactionManager transactionManager) {
        this.readOnlyNewTx = new TransactionTemplate(transactionManager);
        this.readOnlyNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readOnlyNewTx.setReadOnly(true);
        this.writeNewTx = new TransactionTemplate(transactionManager);
        this.writeNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Run {@code work} as a read-only transaction inside workspace {@code tenantId}. */
    public <T> T read(UUID tenantId, Supplier<T> work) {
        return run(tenantId, readOnlyNewTx, work);
    }

    /**
     * Run {@code work} as a read-write transaction inside workspace {@code tenantId}.
     * For the few writes that belong to a workspace's own data — today only its
     * audit trail, whose insert policy accepts rows for the bound tenant only.
     */
    public <T> T write(UUID tenantId, Supplier<T> work) {
        return run(tenantId, writeNewTx, work);
    }

    private static <T> T run(UUID tenantId, TransactionTemplate tx, Supplier<T> work) {
        Objects.requireNonNull(tenantId, "tenantId");
        UUID previousTenant = TenantContext.getTenantId();
        UUID previousUser = TenantContext.getUserId();
        TenantContext.setTenantId(tenantId);
        try {
            return tx.execute(status -> work.get());
        } finally {
            if (previousTenant == null) {
                TenantContext.clear();
                if (previousUser != null) TenantContext.setUserId(previousUser);
            } else {
                TenantContext.setTenantId(previousTenant);
                TenantContext.setUserId(previousUser);
            }
        }
    }
}
