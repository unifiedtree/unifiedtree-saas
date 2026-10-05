package com.hrms.api.employee;

import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.service.EmployeeContactGuard;
import com.hrms.employee.service.EmployeeContactGuard.Field;
import com.hrms.employee.service.EmployeeContactGuard.Owner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** GET /v1/employees/email-check and /phone-check: what the forms show as you type. */
class EmployeeContactCheckControllerTest {

    private static final UUID TENANT = UUID.randomUUID();
    private final EmployeeContactGuard guard = mock(EmployeeContactGuard.class);
    private final EmployeeContactCheckController controller = new EmployeeContactCheckController(guard);
    private final Owner reader = new Owner(UUID.randomUUID(), "Reader User", "EMP002", false, Field.WORK);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    private static void signInWith(String permission) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                List.of(new SimpleGrantedAuthority(permission))));
    }

    @Test
    void aFreeEmailIsAvailable() {
        when(guard.emailOwner(eq(TENANT), any(), any())).thenReturn(Optional.empty());
        var r = controller.emailCheck("new@x.com", null);
        assertThat(r.available()).isTrue();
        assertThat(r.message()).isNull();
    }

    @Test
    void hrSeesWhoHasTheEmail() {
        signInWith("hrms.employee.write");
        UUID self = UUID.randomUUID();
        when(guard.emailOwner(TENANT, "READER@unifiedtree.demo ", self)).thenReturn(Optional.of(reader));
        var r = controller.emailCheck("READER@unifiedtree.demo ", self);
        assertThat(r.available()).isFalse();
        assertThat(r.ownerName()).isEqualTo("Reader User");
        assertThat(r.ownerCode()).isEqualTo("EMP002");
        assertThat(r.field()).isEqualTo("WORK");
        assertThat(r.message()).isEqualTo("This email already belongs to Reader User (EMP002).");
    }

    @Test
    void aManagerWhoCantReadEveryRecordIsToldWithoutAName() {
        signInWith("hrms.employee.team.manage");
        when(guard.emailOwner(eq(TENANT), any(), any())).thenReturn(Optional.of(reader));
        var r = controller.emailCheck("reader@unifiedtree.demo", null);
        assertThat(r.available()).isFalse();
        assertThat(r.ownerName()).isNull();
        assertThat(r.ownerCode()).isNull();
        assertThat(r.message()).isEqualTo(EmployeeContactGuard.GENERIC_EMAIL_MESSAGE);
    }

    @Test
    void aSharedPhoneIsReportedNotRefused() {
        signInWith("hrms.employee.read");
        when(guard.phoneOwners(eq(TENANT), eq("9845012345"), any())).thenReturn(List.of(reader));
        var r = controller.phoneCheck("9845012345", null);
        assertThat(r.inUse()).isTrue();
        assertThat(r.usedBy()).extracting(EmployeeContactCheckController.PhoneUser::name).containsExactly("Reader User");
        assertThat(r.message()).isEqualTo("Also used by Reader User (EMP002).");

        when(guard.phoneOwners(eq(TENANT), eq("9000000001"), any())).thenReturn(List.of());
        assertThat(controller.phoneCheck("9000000001", null).inUse()).isFalse();
    }

    @Test
    void bothChecksNeedTheAddOrEditPermission() throws Exception {
        for (String m : List.of("emailCheck", "phoneCheck")) {
            PreAuthorize p = EmployeeContactCheckController.class.getMethod(m, String.class, UUID.class).getAnnotation(PreAuthorize.class);
            assertThat(p.value()).contains("hasAuthority('hrms.employee.write')").contains("hrms.employee.team.manage");
        }
    }
}
