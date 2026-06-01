package com.unifiedtree.modules.crm;

import org.springframework.context.annotation.Configuration;

/**
 * Empty configuration placeholder so the mod-crm Maven module has at least
 * one Spring bean class and compiles cleanly under the canonical profile.
 *
 * <p>The CRM teammate replaces this with real configuration as the module
 * grows. See {@code backend/modules/mod-crm/README.md} for the contract.
 *
 * <p>This class is picked up automatically by
 * {@code com.hrms.app.config.CanonicalProfileScan} because the canonical
 * scan list includes {@code com.unifiedtree.**}.
 */
@Configuration
public class CrmModuleConfiguration {
}
