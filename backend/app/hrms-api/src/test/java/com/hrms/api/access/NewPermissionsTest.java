package com.hrms.api.access;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V143.69: which permissions a business-made role is told about. Release 2's
 * permissions are dated 2 Oct 2026; everything older is undated.
 */
class NewPermissionsTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final Instant RELEASE_2 = Instant.parse("2026-10-02T00:00:00Z");
    private static final Set<String> ALL_MODULES = Set.of("hrms", "attendance", "leave");

    private static NewPermissions.Catalogued perm(String code, String module, Instant addedAt) {
        return new NewPermissions.Catalogued(code, code, module, "What " + code + " lets someone do", "LOW", null, addedAt);
    }

    private static final NewPermissions.Catalogued OLD = perm("hrms.employee.read", "hrms", null);
    private static final NewPermissions.Catalogued TEAM_MESSAGE = perm("hrms.team.message", "hrms", RELEASE_2);
    private static final NewPermissions.Catalogued APPLY_FOR_OTHERS = perm("hrms.leave.apply.others", "leave", RELEASE_2);
    private static final NewPermissions.Catalogued TIMESHEETS = perm("hrms.timesheet.approve", "attendance", RELEASE_2);
    private static final List<NewPermissions.Catalogued> CATALOGUE = List.of(OLD, TEAM_MESSAGE, APPLY_FOR_OTHERS, TIMESHEETS);

    private static NewPermissions.RoleDates businessRole(Instant created, Instant reviewed) {
        return new NewPermissions.RoleDates(UUID.randomUUID(), TENANT, created, reviewed);
    }

    private static List<String> codes(List<NewPermissions.Catalogued> perms) {
        return perms.stream().map(NewPermissions.Catalogued::code).toList();
    }

    @Test
    void aPermissionFromBeforeDatingBeganIsNeverNew() {
        var role = businessRole(Instant.parse("2025-01-01T00:00:00Z"), null);
        assertThat(codes(NewPermissions.forRole(role, List.of(OLD), Set.of(), ALL_MODULES))).isEmpty();
    }

    @Test
    void releaseTwoPermissionsAreNewForARoleMadeBeforeTheSecondOfOctober() {
        var role = businessRole(Instant.parse("2026-09-15T10:00:00Z"), null);
        assertThat(codes(NewPermissions.forRole(role, CATALOGUE, Set.of(), ALL_MODULES)))
                .containsExactly("hrms.timesheet.approve", "hrms.team.message", "hrms.leave.apply.others");
    }

    @Test
    void aRoleMadeAfterThePermissionWasAddedIsNotToldAboutIt() {
        var role = businessRole(Instant.parse("2026-10-03T09:00:00Z"), null);
        assertThat(NewPermissions.forRole(role, CATALOGUE, Set.of(), ALL_MODULES)).isEmpty();
    }

    @Test
    void reviewingTheRoleHidesWhatWasAddedBeforeTheReview() {
        var reviewed = businessRole(Instant.parse("2026-09-15T10:00:00Z"), Instant.parse("2026-10-04T08:00:00Z"));
        assertThat(NewPermissions.forRole(reviewed, CATALOGUE, Set.of(), ALL_MODULES)).isEmpty();
        // ...but a permission added after the review is new again
        var later = perm("hrms.something.new", "hrms", Instant.parse("2026-11-01T00:00:00Z"));
        assertThat(codes(NewPermissions.forRole(reviewed, List.of(TEAM_MESSAGE, later), Set.of(), ALL_MODULES)))
                .containsExactly("hrms.something.new");
    }

    @Test
    void aPermissionTheRoleAlreadyHoldsIsNotListed() {
        var role = businessRole(Instant.parse("2026-09-15T10:00:00Z"), null);
        assertThat(codes(NewPermissions.forRole(role, CATALOGUE, Set.of("hrms.team.message", "hrms.timesheet.approve"), ALL_MODULES)))
                .containsExactly("hrms.leave.apply.others");
    }

    @Test
    void builtInRolesNeverGetANotice() {
        var builtIn = new NewPermissions.RoleDates(UUID.randomUUID(), null, Instant.parse("2025-01-01T00:00:00Z"), null);
        assertThat(NewPermissions.forRole(builtIn, CATALOGUE, Set.of(), ALL_MODULES)).isEmpty();
    }

    @Test
    void platformPermissionsAreNeverListed() {
        var role = businessRole(Instant.parse("2026-09-15T10:00:00Z"), null);
        var platform = perm("platform.tenants.manage", "platform", RELEASE_2);
        assertThat(NewPermissions.forRole(role, List.of(platform), Set.of(), ALL_MODULES)).isEmpty();
    }

    @Test
    void aPermissionOfAModuleTheWorkspaceHasNotSwitchedOnIsNotListed() {
        var role = businessRole(Instant.parse("2026-09-15T10:00:00Z"), null);
        // No leave module: the leave permission is left out. Expense isn't a gated module, so it's always on.
        var expense = perm("hrms.expense.claim.others", "expense", RELEASE_2);
        assertThat(codes(NewPermissions.forRole(role, List.of(APPLY_FOR_OTHERS, TEAM_MESSAGE, expense), Set.of(), Set.of("hrms"))))
                .containsExactly("hrms.expense.claim.others", "hrms.team.message");
        assertThat(NewPermissions.moduleOn("leave", Set.of("hrms"))).isFalse();
        assertThat(NewPermissions.moduleOn("leave", Set.of("leave"))).isTrue();
        assertThat(NewPermissions.moduleOn("expense", Set.of())).isTrue();
    }

    // ── the migration (V143.69) ──────────────────────────────────────────────

    private static final Path CANONICAL = Path.of("../hrms-app/src/main/resources/db/canonical");

    @Test
    void theBackfillDatesExactlyThePermissionsReleaseTwoAdded() throws Exception {
        // Every code INSERTed into rbac.permissions by V143_50 .. V143_66 (Release 2).
        Set<String> added = new TreeSet<>();
        Pattern version = Pattern.compile("^V143_(\\d+)__.*\\.sql$");
        Pattern insert = Pattern.compile("INSERT INTO rbac\\.permissions.*?ON CONFLICT", Pattern.DOTALL);
        Pattern firstValue = Pattern.compile("\\(\\s*'([a-z0-9_.-]+)'\\s*,");
        try (var files = Files.list(CANONICAL)) {
            for (Path f : files.toList()) {
                Matcher v = version.matcher(f.getFileName().toString());
                if (!v.matches() || Integer.parseInt(v.group(1)) < 50 || Integer.parseInt(v.group(1)) > 66) continue;
                Matcher block = insert.matcher(Files.readString(f));
                while (block.find()) {
                    Matcher code = firstValue.matcher(block.group());
                    while (code.find()) added.add(code.group(1));
                }
            }
        }
        String sql = Files.readString(CANONICAL.resolve("V143_69__permission_added_at_and_role_review.sql"));
        int update = sql.indexOf("UPDATE rbac.permissions");
        String list = sql.substring(sql.indexOf("code IN (", update), sql.indexOf(")", sql.indexOf("code IN (", update)));
        Set<String> backfilled = new TreeSet<>();
        Matcher quoted = Pattern.compile("'([^']+)'").matcher(list);
        while (quoted.find()) backfilled.add(quoted.group(1));

        assertThat(added).containsExactly("hrms.expense.claim.others", "hrms.leave.apply.others",
                "hrms.probation.team.decide", "hrms.team.message", "hrms.timesheet.approve");
        assertThat(backfilled).isEqualTo(added);
        assertThat(sql.substring(update, sql.indexOf(";", update))).contains("SET added_at = '2026-10-02'", "WHERE added_at IS NULL");
    }

    @Test
    void existingPermissionsStayUndatedAndOnlyLaterOnesGetTheDefault() throws Exception {
        String sql = Files.readString(CANONICAL.resolve("V143_69__permission_added_at_and_role_review.sql"));
        int add = sql.indexOf("ALTER TABLE rbac.permissions ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;");
        int dflt = sql.indexOf("ALTER TABLE rbac.permissions ALTER COLUMN added_at SET DEFAULT now();");
        assertThat(add).isPositive();
        assertThat(dflt).isGreaterThan(add);
        assertThat(sql).contains("ALTER TABLE rbac.roles ADD COLUMN IF NOT EXISTS permissions_reviewed_at TIMESTAMPTZ;");
        // purely additive: no grant, no permission row, nothing dropped
        assertThat(sql).doesNotContain("INSERT INTO", "DELETE FROM", "DROP ", "role_permissions");
    }
}
