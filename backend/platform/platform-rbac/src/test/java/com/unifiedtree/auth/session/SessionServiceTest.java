package com.unifiedtree.auth.session;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The per-request "is this session still signed in?" check. It reads the
 * RLS-isolated refresh-token table, so it must always read under the access
 * token's own workspace, and it must never sign people out on a database error.
 */
class SessionServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID sid = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final SessionService sessions = new SessionService(jdbc, mock(PlatformTransactionManager.class));

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @Test
    void readsUnderTheTokensWorkspaceAndPutsTheBoundOneBack() {
        UUID other = UUID.randomUUID();
        TenantContext.setTenantId(other);
        AtomicReference<UUID> seen = new AtomicReference<>();
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenAnswer(inv -> {
            seen.set(TenantContext.getTenantId());
            return Boolean.TRUE;
        });

        assertTrue(sessions.isActive(tenant, sid));
        assertEquals(tenant, seen.get(), "the check must run under the token's workspace");
        assertEquals(other, TenantContext.getTenantId(), "the request's own binding is restored");
    }

    @Test
    void anActiveAnswerIsCachedSoTheDatabaseIsNotAskedEveryRequest() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(Boolean.TRUE);
        assertTrue(sessions.isActive(tenant, sid));
        assertTrue(sessions.isActive(tenant, sid));
        verify(jdbc, times(1)).queryForObject(anyString(), eq(Boolean.class), any(Object[].class));
    }

    @Test
    void aSignedOutSessionIsRefused() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(Boolean.FALSE);
        assertFalse(sessions.isActive(tenant, sid));
        assertNull(TenantContext.getTenantId());
    }

    @Test
    void aDatabaseErrorLetsTheRequestThrough() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class)))
                .thenThrow(new DataAccessResourceFailureException("pool exhausted"));
        assertTrue(sessions.isActive(tenant, sid));
    }
}
