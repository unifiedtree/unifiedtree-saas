package com.hrms.api.audit;

import com.unifiedtree.audit.AuditService;
import com.unifiedtree.auth.session.SignedInEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Every sign-in lands in the audit log, under its own workspace, and never breaks the sign-in. */
class SignInAuditListenerTest {

    private static final String CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

    private final AuditService audit = mock(AuditService.class);
    private final SignInAuditListener listener = new SignInAuditListener(audit);
    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    @Test
    void aSignInIsWrittenAsLoginOnThePersonWithWhereFrom() {
        AtomicReference<UUID> boundDuringWrite = new AtomicReference<>();
        doAnswer(inv -> { boundDuringWrite.set(TenantContext.getTenantId()); return null; })
                .when(audit).recordAs(any(), any(), any(), any(), any(), any(), any(), any(), any());

        listener.onSignedIn(new SignedInEvent(tenant, user, "asha@acme.in", UUID.randomUUID(), CHROME, "203.0.113.7"));

        verify(audit).recordAs(eq(user), eq("asha@acme.in"), eq("203.0.113.7"), eq(CHROME),
                eq("auth"), eq("LOGIN"), eq("USER"), eq(user), eq("Signed in on Chrome on Windows"));
        assertEquals(tenant, boundDuringWrite.get(), "written under the sign-in's own workspace (RLS)");
        assertNull(TenantContext.getTenantId(), "the thread's workspace is put back afterwards");
        assertNull(com.hrms.core.tenant.TenantContext.getTenantId());
    }

    @Test
    void aFailedWriteNeverReachesTheSignIn() {
        doThrow(new IllegalStateException("db down")).when(audit).recordAs(any(), any(), any(), any(), any(), any(), any(), any(), any());
        UUID other = UUID.randomUUID();
        TenantContext.setTenantId(other);
        assertDoesNotThrow(() -> listener.onSignedIn(new SignedInEvent(tenant, user, "asha@acme.in", null, null, null)));
        assertEquals(other, TenantContext.getTenantId());
    }

    @Test
    void anUnknownDeviceStillReadsAsASignIn() {
        assertEquals("Signed in", SignInAuditListener.summary(null));
        assertEquals("Signed in on Mobile app on Android", SignInAuditListener.summary("okhttp/4.12.0"));
    }
}
