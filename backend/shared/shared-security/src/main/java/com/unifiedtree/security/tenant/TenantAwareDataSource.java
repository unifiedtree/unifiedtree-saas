package com.unifiedtree.security.tenant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * Wraps a delegate {@link DataSource} and, on every {@link #getConnection()},
 * sets {@code app.tenant_id} on the connection's current transaction using
 * {@code SET LOCAL}.
 *
 * <p>The RLS policies in {@code V001__create_schemas.sql} read this via the
 * {@code current_tenant_id()} helper. {@code SET LOCAL} is mandatory because
 * PgBouncer's transaction pool reuses physical connections across logical
 * transactions - a plain {@code SET} would leak the tenant id across requests.
 *
 * <p>Connections handed out before {@link TenantContext} has been populated
 * (boot-time Flyway, scheduled jobs, platform-admin paths) skip the
 * {@code SET LOCAL} so the {@code current_tenant_id()} helper returns NULL,
 * which RLS treats as "no rows visible" - fail-closed.
 */
public class TenantAwareDataSource implements DataSource {

    private static final Logger log = LoggerFactory.getLogger(TenantAwareDataSource.class);

    private final DataSource delegate;

    public TenantAwareDataSource(DataSource delegate) {
        this.delegate = delegate;
    }

    @Override
    public Connection getConnection() throws SQLException {
        return applyTenant(delegate.getConnection());
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return applyTenant(delegate.getConnection(username, password));
    }

    private Connection applyTenant(Connection raw) {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            // Platform-admin path or boot-time migration (Flyway). Leave the
            // connection untouched so Flyway's transaction handling works
            // normally. RLS treats current_tenant_id()=NULL as "no rows
            // visible" so tenant tables stay invisible - fail-closed.
            return raw;
        }
        try {
            // Hikari hands out connections in autoCommit=true mode by default.
            // SET LOCAL only persists inside a transaction; in autoCommit=true
            // mode each statement is its own transaction that commits and
            // discards the LOCAL value. Force autoCommit=false BEFORE issuing
            // SET LOCAL so the value lives for the upcoming Spring @Transactional
            // boundary. When the connection returns to the pool Hikari resets
            // session state to the configured default (true).
            if (raw.getAutoCommit()) {
                raw.setAutoCommit(false);
            }
            try (Statement stmt = raw.createStatement()) {
                stmt.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
            }
            log.debug("RLS tenant set on connection: tenant={}", tenantId);
        } catch (SQLException e) {
            log.error("Failed to set tenant context on connection: tenant={}", tenantId, e);
            try { raw.close(); } catch (SQLException ignore) { /* swallow */ }
            throw new IllegalStateException("Could not establish tenant-scoped connection", e);
        }
        return raw;
    }

    // -- pass-through DataSource boilerplate --------------------------------
    @Override public PrintWriter getLogWriter() throws SQLException { return delegate.getLogWriter(); }
    @Override public void setLogWriter(PrintWriter out) throws SQLException { delegate.setLogWriter(out); }
    @Override public void setLoginTimeout(int seconds) throws SQLException { delegate.setLoginTimeout(seconds); }
    @Override public int getLoginTimeout() throws SQLException { return delegate.getLoginTimeout(); }
    @Override public java.util.logging.Logger getParentLogger() {
        return java.util.logging.Logger.getLogger("global");
    }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException {
        return iface.isInstance(this) ? iface.cast(this) : delegate.unwrap(iface);
    }
    @Override public boolean isWrapperFor(Class<?> iface) throws SQLException {
        return iface.isInstance(this) || delegate.isWrapperFor(iface);
    }
}
