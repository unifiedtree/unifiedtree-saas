package com.hrms.api.me;

import com.hrms.api.me.QuickActionsController.QuickActionPrefs;
import com.hrms.api.me.QuickActionsController.SaveRequest;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * G-59 quick-action customisation: the caller's own row only (from the session), up to 6 unique keys in order,
 * null = the default tiles, and a calm answer while V143_97 is not applied.
 */
class QuickActionsControllerTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private QuickActionsController controller;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        jdbc = mock(JdbcTemplate.class);
        controller = new QuickActionsController(jdbc);
        tableReady(true);
    }

    @AfterEach
    void clear() { TenantContext.clear(); }

    private void tableReady(boolean ready) {
        when(jdbc.queryForObject(contains("to_regclass('hrms.user_dashboard_prefs')"), eq(Boolean.class))).thenReturn(ready);
    }

    @Test
    void readsTheCallersOwnPicksInOrder() {
        when(jdbc.queryForList(contains("FROM hrms.user_dashboard_prefs"), eq(String.class), any(), any(), any()))
                .thenReturn(List.of("pay,att,rep"));
        QuickActionPrefs p = controller.get("dashboard");
        assertThat(p.available()).isTrue();
        assertThat(p.picked()).containsExactly("pay", "att", "rep");
        assertThat(p.uses()).isEmpty();
        assertThat(p.month()).matches("\\d{4}-\\d{2}");
        verify(jdbc).queryForList(anyString(), eq(String.class), eq(tenant), eq(user), eq("dashboard"));
    }

    @Test
    void noRowMeansTheDefaultTiles() {
        when(jdbc.queryForList(anyString(), eq(String.class), any(), any(), any())).thenReturn(List.of());
        assertThat(controller.get("home").picked()).isNull();
    }

    @Test
    void savesUpToSixUniqueKeysForTheCaller() {
        QuickActionPrefs p = controller.save("home", new SaveRequest(List.of("leave", "payslip", "wfh")));
        assertThat(p.picked()).containsExactly("leave", "payslip", "wfh");
        verify(jdbc).update(contains("ON CONFLICT (tenant_id, user_id, surface)"), eq(tenant), eq(user), eq("home"), eq("leave,payslip,wfh"));
    }

    @Test
    void resetToDefaultDeletesTheRow() {
        QuickActionPrefs p = controller.save("dashboard", new SaveRequest(null));
        assertThat(p.picked()).isNull();
        verify(jdbc).update(contains("DELETE FROM hrms.user_dashboard_prefs"), eq(tenant), eq(user), eq("dashboard"));
    }

    @Test
    void refusesTooManyDuplicatesEmptyOrOddKeys() {
        assertThat(code(() -> controller.save("home", new SaveRequest(List.of("a", "b", "c", "d", "e", "f", "g"))))).isEqualTo("QUICK_ACTIONS_INVALID");
        assertThat(code(() -> controller.save("home", new SaveRequest(List.of("leave", "leave"))))).isEqualTo("QUICK_ACTIONS_INVALID");
        assertThat(code(() -> controller.save("home", new SaveRequest(List.of())))).isEqualTo("QUICK_ACTIONS_INVALID");
        assertThat(code(() -> controller.save("home", new SaveRequest(List.of("pay,att"))))).isEqualTo("QUICK_ACTIONS_INVALID");
        assertThat(code(() -> controller.save("home", new SaveRequest(Arrays.asList("pay", null))))).isEqualTo("QUICK_ACTIONS_INVALID");
        assertThatThrownBy(() -> controller.save("home", new SaveRequest(List.of("x".repeat(41)))))
                .isInstanceOfSatisfying(HrmsException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
        // six is fine
        assertThat(controller.save("home", new SaveRequest(List.of("a", "b", "c", "d", "e", "f"))).picked()).hasSize(6);
    }

    @Test
    void onlyDashboardOrHome() {
        assertThat(code(() -> controller.get("payroll"))).isEqualTo("QUICK_ACTIONS_SURFACE_INVALID");
        assertThat(QuickActionsController.surface(" Home ")).isEqualTo("home");
    }

    @Test
    void withoutTheTableReadsAreUnavailableAndSavesNotReady() {
        tableReady(false);
        QuickActionPrefs p = controller.get("dashboard");
        assertThat(p.available()).isFalse();
        assertThat(p.picked()).isNull();
        assertThatThrownBy(() -> controller.save("dashboard", new SaveRequest(List.of("att"))))
                .isInstanceOf(FeatureNotReady.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void bindsTheTenantInsideItsOwnTransactionSoRowLevelSecuritySeesTheRow() throws Exception {
        when(jdbc.queryForList(anyString(), eq(String.class), any(), any(), any())).thenReturn(List.of());
        controller.get("dashboard");
        controller.save("dashboard", new SaveRequest(List.of("att")));
        verify(jdbc, org.mockito.Mockito.times(2))
                .queryForObject(contains("set_config('app.tenant_id'"), eq(String.class), eq(tenant.toString()));
        for (String m : List.of("get", "save")) {
            assertThat(Arrays.stream(QuickActionsController.class.getMethods()).filter(x -> x.getName().equals(m))
                    .findFirst().orElseThrow().getAnnotation(org.springframework.transaction.annotation.Transactional.class))
                    .as(m + " is transactional").isNotNull();
        }
    }

    @Test
    void needsASession() {
        TenantContext.clear();
        assertThat(code(() -> controller.get("dashboard"))).isEqualTo("NOT_AUTHENTICATED");
    }

    @Test
    void anySignedInPersonForTheirOwnRow() throws Exception {
        for (String m : List.of("get", "save")) {
            PreAuthorize pa = Arrays.stream(QuickActionsController.class.getMethods()).filter(x -> x.getName().equals(m))
                    .findFirst().orElseThrow().getAnnotation(PreAuthorize.class);
            assertThat(pa.value()).isEqualTo("isAuthenticated()");
        }
    }

    private static String code(Runnable r) {
        try {
            r.run();
        } catch (HrmsException e) {
            return e.getErrorCode();
        }
        return null;
    }
}
