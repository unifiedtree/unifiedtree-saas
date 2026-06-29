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

        // expense module (canonical schema: expense_mgmt.*, V067)
        "com.hrms.expense",

        // Phase-3 modules (canonical schemas advance_mgmt/fnf_mgmt/hiring_mgmt/performance_mgmt, V068-V071)
        "com.hrms.advance",
        "com.hrms.fnf",
        "com.hrms.hiring",
        "com.hrms.performance",
        "com.hrms.document",
        "com.hrms.learning",
        "com.hrms.compliance",
        "com.hrms.policy",
        "com.hrms.pli",
        "com.hrms.integration",
        "com.hrms.notiftemplate",

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
        "com.hrms.api.access",
        "com.hrms.api.probation",
        "com.hrms.api.payroll",
        "com.hrms.api.expense",
        "com.hrms.api.advance",
        "com.hrms.api.fnf",
        "com.hrms.api.hiring",
        "com.hrms.api.performance",
        "com.hrms.api.document",
        "com.hrms.api.learning",
        "com.hrms.api.compliance",
        "com.hrms.api.policy",
        "com.hrms.api.pli",
        "com.hrms.api.integration",
        "com.hrms.api.notiftemplate",

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
        "com.hrms.expense.entity",
        "com.hrms.advance.entity",
        "com.hrms.fnf.entity",
        "com.hrms.hiring.entity",
        "com.hrms.performance.entity",
        "com.hrms.document.entity",
        "com.hrms.learning.entity",
        "com.hrms.compliance.entity",
        "com.hrms.policy.entity",
        "com.hrms.pli.entity",
        "com.hrms.integration.entity",
        "com.hrms.notiftemplate.entity",
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
        "com.hrms.expense.repository",
        "com.hrms.advance.repository",
        "com.hrms.fnf.repository",
        "com.hrms.hiring.repository",
        "com.hrms.performance.repository",
        "com.hrms.document.repository",
        "com.hrms.learning.repository",
        "com.hrms.compliance.repository",
        "com.hrms.policy.repository",
        "com.hrms.pli.repository",
        "com.hrms.integration.repository",
        "com.hrms.notiftemplate.repository",
        "com.hrms.letters.repository",
        "com.unifiedtree.settings.repository",
        "com.unifiedtree.auth.repository",
        "com.unifiedtree.rbac.repository",
        "com.unifiedtree.audit.repository",
        "com.hrms.api.invitation"
})
public class CanonicalProfileScan {
}
