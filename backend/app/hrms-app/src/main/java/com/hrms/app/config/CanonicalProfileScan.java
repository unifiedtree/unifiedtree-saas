package com.hrms.app.config;

import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Component / entity / repository scan for the canonical profile.
 *
 * <p>Only packages that target the new canonical schemas are loaded.
 *
 * <p>Excluded packages and why:
 * <ul>
 *   <li>{@code com.hrms.auth}, {@code com.hrms.tenant}, {@code com.hrms.notification} — fully
 *       superseded by canonical platform packages ({@code com.unifiedtree.*}).</li>
 *   <li>{@code com.hrms.core.tenant.*} Hibernate-filter isolation — replaced by RLS (V012).</li>
 *   <li>Geofence + face-checkin endpoints ({@code /geo-fence/check}, {@code /face-checkin}, etc.)
 *       are excluded via {@code LegacyAttendanceExtrasController} which carries
 *       {@code @Profile("!canonical")} — those endpoints simply do not load here.</li>
 * </ul>
 */
@Configuration
@Profile("canonical")
@ComponentScan(basePackages = {
        // shared kernel
        "com.hrms.core.exception",
        "com.hrms.core.audit",
        "com.hrms.core.crypto",

        // canonical business modules
        "com.hrms.employee.workforce",
        "com.hrms.employee.service",
        "com.hrms.employee.repository",
        "com.hrms.employee.mapper",

        // onboarding + profile
        "com.hrms.employee.entity",

        // attendance (canonical schemas: attendance.*, V007 + V028)
        "com.hrms.attendance",

        // leave (canonical schemas: leave_mgmt.*, V008/V022/V024 + V028)
        "com.hrms.leave",

        // letters module
        "com.hrms.letters",

        // payroll module (seeder @Service; LopCalculator is a pure POJO, not scanned)
        "com.hrms.payroll.service",

        // canonical REST controllers
        "com.hrms.api.workforce",
        "com.hrms.api.settings",
        "com.hrms.api.auth.canonical",
        "com.hrms.api.rbac",
        "com.hrms.api.employee",
        "com.hrms.api.onboarding",
        "com.hrms.api.audit",
        "com.hrms.api.attendance",
        "com.hrms.api.leave",
        "com.hrms.api.letters",
        "com.hrms.api.invitation",
        "com.hrms.api.mail",
        "com.hrms.api.modulereq",
        "com.hrms.api.saas",
        "com.hrms.api.access",
        "com.hrms.api.probation",
        "com.hrms.api.payroll",

        // app-layer: reports, bulk import, jobs
        "com.hrms.app.reports",
        "com.hrms.app.bulk",
        "com.hrms.app.jobs",
        "com.hrms.app.config",

        // all new platform code
        "com.unifiedtree"
})
@EntityScan(basePackages = {
        "com.hrms.employee.workforce.entity",
        "com.hrms.employee.entity",
        "com.hrms.attendance.entity",
        "com.hrms.leave.entity",
        "com.hrms.letters.domain",
        "com.unifiedtree.settings.entity",
        "com.unifiedtree.auth.entity",
        "com.unifiedtree.rbac.entity",
        "com.unifiedtree.audit.entity",
        "com.hrms.api.invitation"
})
@EnableJpaRepositories(basePackages = {
        "com.hrms.employee.workforce.repository",
        "com.hrms.employee.repository",
        "com.hrms.attendance.repository",
        "com.hrms.leave.repository",
        "com.hrms.letters.repository",
        "com.unifiedtree.settings.repository",
        "com.unifiedtree.auth.repository",
        "com.unifiedtree.rbac.repository",
        "com.unifiedtree.audit.repository",
        "com.hrms.api.invitation"
})
public class CanonicalProfileScan {
}
