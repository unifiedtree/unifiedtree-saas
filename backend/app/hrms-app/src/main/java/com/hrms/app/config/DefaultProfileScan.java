package com.hrms.app.config;

import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Component / entity / repository scan for every non-canonical profile.
 * Preserves the legacy broad scan over com.hrms.* + com.unifiedtree.*.
 */
@Configuration
@Profile("!canonical")
@ComponentScan(basePackages = { "com.hrms", "com.unifiedtree" })
@EntityScan(basePackages = { "com.hrms", "com.unifiedtree" })
@EnableJpaRepositories(basePackages = { "com.hrms", "com.unifiedtree" })
public class DefaultProfileScan {
}
