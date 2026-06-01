package com.hrms.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * UnifiedTree HRMS application entry point.
 *
 * <p>The component / entity / repository scan paths are intentionally NOT
 * declared here. They are owned by two profile-gated configuration classes:
 *
 * <ul>
 *   <li>{@link com.hrms.app.config.DefaultProfileScan} — active in every
 *       profile except {@code canonical}; preserves the legacy broad scan.</li>
 *   <li>{@link com.hrms.app.config.CanonicalProfileScan} — active in the
 *       {@code canonical} profile; restricts scan to canonical packages so
 *       Hibernate validate only sees entities that have matching tables in
 *       the new schema.</li>
 * </ul>
 *
 * <p>Without this split, the canonical profile would fail Hibernate's
 * {@code ddl-auto=validate} on every legacy entity that targets
 * {@code public.*} tables which don't exist in the canonical schema.
 */
@SpringBootApplication(scanBasePackages = "com.hrms.app")
@EnableAsync
@EnableScheduling
public class HrmsApplication {

    public static void main(String[] args) {
        SpringApplication.run(HrmsApplication.class, args);
    }
}
