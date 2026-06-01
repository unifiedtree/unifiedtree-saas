package com.unifiedtree.security.config;

import com.unifiedtree.security.tenant.TenantAwareDataSource;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;

/**
 * Auto-configures tenant-aware DataSource wrapping and registers the
 * tenant context filter.
 *
 * <p>Activated automatically when this jar is on the classpath. Disable via
 * {@code unifiedtree.security.rls.enabled=false} (e.g. for unit tests).
 */
@AutoConfiguration(before = DataSourceAutoConfiguration.class)
@ConditionalOnClass(DataSource.class)
@ConditionalOnProperty(prefix = "unifiedtree.security.rls", name = "enabled", havingValue = "true", matchIfMissing = true)
@ComponentScan("com.unifiedtree.security")
public class SharedSecurityAutoConfiguration {

    /**
     * Build a Hikari pool from the standard spring.datasource.* properties,
     * then wrap it so every leased connection gets SET LOCAL app.tenant_id.
     */
    @Bean
    @Primary
    @ConditionalOnMissingBean(DataSource.class)
    public DataSource tenantAwareDataSource(DataSourceProperties props,
                                            @Qualifier("hikariConfigProps") HikariConfigProperties hikariProps) {
        HikariDataSource hikari = props.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
        if (hikariProps.getMaximumPoolSize() > 0) hikari.setMaximumPoolSize(hikariProps.getMaximumPoolSize());
        if (hikariProps.getMinimumIdle() >= 0)    hikari.setMinimumIdle(hikariProps.getMinimumIdle());
        if (hikariProps.getConnectionTimeout() > 0) hikari.setConnectionTimeout(hikariProps.getConnectionTimeout());
        if (hikariProps.getIdleTimeout() > 0)     hikari.setIdleTimeout(hikariProps.getIdleTimeout());
        if (hikariProps.getMaxLifetime() > 0)     hikari.setMaxLifetime(hikariProps.getMaxLifetime());
        return new TenantAwareDataSource(hikari);
    }

    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public HikariConfigProperties hikariConfigProps() {
        return new HikariConfigProperties();
    }

    // TenantContextFilter is @Component picked up by the @ComponentScan above,
    // so no explicit @Bean factory is needed. The filter requires a
    // configuration property bound via constructor injection.

    /**
     * Mirror of the subset of HikariCP properties we care about. We rebind
     * them because we're wrapping the DataSource and the default Hikari
     * auto-binding sees our wrapper, not the underlying HikariDataSource.
     */
    public static class HikariConfigProperties {
        private int  maximumPoolSize    = 20;
        private int  minimumIdle        = 5;
        private long connectionTimeout  = 20_000L;
        private long idleTimeout        = 300_000L;
        private long maxLifetime        = 1_200_000L;

        public int  getMaximumPoolSize() { return maximumPoolSize; }
        public void setMaximumPoolSize(int v) { this.maximumPoolSize = v; }
        public int  getMinimumIdle() { return minimumIdle; }
        public void setMinimumIdle(int v) { this.minimumIdle = v; }
        public long getConnectionTimeout() { return connectionTimeout; }
        public void setConnectionTimeout(long v) { this.connectionTimeout = v; }
        public long getIdleTimeout() { return idleTimeout; }
        public void setIdleTimeout(long v) { this.idleTimeout = v; }
        public long getMaxLifetime() { return maxLifetime; }
        public void setMaxLifetime(long v) { this.maxLifetime = v; }
    }
}
