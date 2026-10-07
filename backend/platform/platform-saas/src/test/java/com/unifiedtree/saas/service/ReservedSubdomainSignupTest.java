package com.unifiedtree.saas.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Sign-up never hands out one of UnifiedTree's own addresses (admin, marketing, business, ...). */
class ReservedSubdomainSignupTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final SaasWriter writer = mock(SaasWriter.class);
    private final SaasService saas = new SaasService(jdbc, writer, null, null, "unifiedtree.com",
            e -> { }, null, null, null, null);

    @Test
    void theAvailabilityCheckSaysReservedWithoutLookingInTheDatabase() {
        for (String name : new String[]{"admin", "Marketing", "business", "www", "api", "app", "mail"}) {
            var r = saas.checkSubdomain(name);
            assertThat(r.available()).as(name).isFalse();
            assertThat(r.reason()).as(name).contains("reserved");
        }
        verifyNoInteractions(jdbc);
    }

    @Test
    void anOrdinaryFreeNameIsStillAvailable() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);

        assertThat(saas.checkSubdomain("tatagroups").available()).isTrue();
    }

    @Test
    void creatingABusinessOnAReservedAddressIsRefused() {
        when(jdbc.queryForObject(contains("platform.account_workspaces"), eq(Boolean.class), any(UUID.class)))
                .thenReturn(false);

        assertThatThrownBy(() -> saas.createFreeWorkspace(UUID.randomUUID(), "hash",
                "Marketing Co", "marketing", "Asha Rao", "asha@acme.test", null, "India", "Asia/Kolkata", "INR", null))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> {
                    assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(e.getReason()).contains("reserved");
                });
        verifyNoInteractions(writer);
    }
}
