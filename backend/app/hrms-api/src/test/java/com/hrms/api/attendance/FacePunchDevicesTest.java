package com.hrms.api.attendance;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** A face punch's device lands on the face check that cleared it (V143.25, Face tab "Kiosk"). */
class FacePunchDevicesTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FacePunchDevices devices = new FacePunchDevices(jdbc);
    private final UUID tenant = UUID.randomUUID();
    private final UUID login = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    @Test void theDeviceOfAFacePunchIsPutOnTheLatestUnlabelledPassedCheck() {
        devices.link(login.toString(), " Gate kiosk 2 ", "FACE_RECOGNITION");
        verify(jdbc).update(contains("purpose = 'PUNCH_IN' AND result = 'PASS'"),
                eq("Gate kiosk 2"), eq(tenant), eq(login), eq(FacePunchDevices.WINDOW_MINUTES));
    }

    @Test void onlyFacePunchesWithADeviceAreLabelled() {
        devices.link(login.toString(), "Pixel 7", "GPS");
        devices.link(login.toString(), "  ", "FACE_RECOGNITION");
        devices.link(login.toString(), null, "FACE_RECOGNITION");
        devices.link(null, "Pixel 7", "FACE_RECOGNITION");
        verifyNoInteractions(jdbc);
    }

    @Test void aBadLoginIdOrADatabaseErrorNeverFailsThePunch() {
        assertDoesNotThrow(() -> devices.link("not-a-uuid", "Pixel 7", "FACE_RECOGNITION"));
        when(jdbc.update(anyString(), any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> devices.link(login.toString(), "Pixel 7", "FACE_RECOGNITION"));
    }

    @Test void labelsAreTidiedAndFitTheColumn() {
        assertEquals("SM A515F", FacePunchDevices.label("SM\tA515F\n"));
        assertEquals(120, FacePunchDevices.label("k".repeat(300)).length());
        assertNull(FacePunchDevices.label(" "));
        assertTrue(FacePunchDevices.isFaceMethod("face_recognition"));
        assertFalse(FacePunchDevices.isFaceMethod("MANUAL"));
        assertFalse(FacePunchDevices.isFaceMethod(null));
    }
}
