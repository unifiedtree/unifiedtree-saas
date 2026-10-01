package com.hrms.api.employee;

import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.EmployeeDependent;
import com.hrms.employee.entity.EmployeeIdentity;
import com.hrms.employee.repository.EmergencyContactRepository;
import com.hrms.employee.service.EmployeeProfileService;
import com.unifiedtree.rbac.security.PermissionChecker;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Redesign BW-99 (a person reads their own profile sections, identity masked),
 * BW-100 (last sign-in device) and BW-101 (nominee total at most 100 %).
 */
class ProfileSelfAccessTest {

    private static final String SELF = "#employeeId == @securityHelper.currentEmployeeId()";

    private static String guard(Method m) {
        PreAuthorize p = m.getAnnotation(PreAuthorize.class);
        assertNotNull(p, m.getName() + " has no @PreAuthorize");
        return p.value();
    }

    // ── BW-99: who may call what ──────────────────────────────────────────

    @Test void selfMayReadTheFiveSectionsAndIdentity() {
        Set<String> selfReads = Set.of("getAddresses", "getEducation", "getExperience", "getDependents", "getEmergencyContacts", "getIdentity");
        List<String> seen = new ArrayList<>();
        for (Method m : EmployeeProfileController.class.getDeclaredMethods()) {
            if (!m.isAnnotationPresent(GetMapping.class)) continue;
            if (selfReads.contains(m.getName())) {
                assertTrue(guard(m).contains(SELF), m.getName() + " must let a person read their own");
                assertTrue(guard(m).startsWith("@perm.check('hrms.employee.profile.read')")
                        || guard(m).startsWith("@perm.check('hrms.employee.identity.read')"), m.getName() + " keeps HR's permission");
                seen.add(m.getName());
            }
        }
        assertEquals(selfReads.size(), seen.size(), "every self read is mapped: " + seen);
    }

    @Test void bankAccountsStayHrOnly() throws Exception {
        Method m = EmployeeProfileController.class.getDeclaredMethod("getBankAccounts", UUID.class);
        assertFalse(guard(m).contains("securityHelper"), "bank details are not opened to self");
    }

    @Test void everyWriteIsUnchanged() {
        int writes = 0;
        for (Method m : EmployeeProfileController.class.getDeclaredMethods()) {
            boolean write = m.isAnnotationPresent(PostMapping.class) || m.isAnnotationPresent(PutMapping.class) || m.isAnnotationPresent(DeleteMapping.class);
            if (!write) continue;
            writes++;
            assertFalse(guard(m).contains("securityHelper"), m.getName() + " must not be opened to self");
            assertTrue(guard(m).matches("@perm\\.check\\('hrms\\.employee\\.(profile|identity|bank)\\.write'\\)"), m.getName() + ": " + guard(m));
        }
        assertTrue(writes >= 11, "found " + writes + " writes");
    }

    // ── BW-99: the masked identity ────────────────────────────────────────

    private static EmployeeIdentity identity(UUID employeeId) {
        EmployeeIdentity i = new EmployeeIdentity();
        i.setEmployeeId(employeeId);
        i.setPanEncrypted("enc-pan");
        i.setPassportNumberEncrypted("enc-pp");
        i.setAadhaarLast4("4821");
        i.setUan("100482173921");
        i.setEsicNumber("3100123456");
        return i;
    }

    private static EmployeeProfileController controller(EmployeeProfileService svc, PermissionChecker perm) {
        return new EmployeeProfileController(svc, mock(EmergencyContactRepository.class), perm);
    }

    @Test void selfWithoutIdentityPermissionSeesOnlyTheLastFour() {
        UUID me = UUID.randomUUID();
        EmployeeProfileService svc = mock(EmployeeProfileService.class);
        EmployeeIdentity id = identity(me);
        when(svc.getIdentity(me)).thenReturn(id);
        when(svc.decryptPan(id)).thenReturn("ABCPS1234K");
        when(svc.decryptPassport(id)).thenReturn("P4821773");
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check("hrms.employee.identity.read")).thenReturn(false);

        EmployeeProfileController.IdentityResponse r = controller(svc, perm).getIdentity(me);
        assertEquals("••••••234K", r.pan());
        assertEquals("••••1773", r.passportNumber());
        assertEquals("••••••••3921", r.uan());
        assertEquals("••••••3456", r.esicNumber());
        assertEquals("4821", r.aadhaarLast4());
        assertFalse(r.pan().contains("ABCPS"));
    }

    @Test void hrWithIdentityPermissionStillSeesFullNumbers() {
        UUID other = UUID.randomUUID();
        EmployeeProfileService svc = mock(EmployeeProfileService.class);
        EmployeeIdentity id = identity(other);
        when(svc.getIdentity(other)).thenReturn(id);
        when(svc.decryptPan(id)).thenReturn("ABCPS1234K");
        when(svc.decryptPassport(id)).thenReturn("P4821773");
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check("hrms.employee.identity.read")).thenReturn(true);

        EmployeeProfileController.IdentityResponse r = controller(svc, perm).getIdentity(other);
        assertEquals("ABCPS1234K", r.pan());
        assertEquals("P4821773", r.passportNumber());
        assertEquals("100482173921", r.uan());
    }

    @Test void permissionLookupFailureMasks() {
        UUID me = UUID.randomUUID();
        EmployeeProfileService svc = mock(EmployeeProfileService.class);
        EmployeeIdentity id = identity(me);
        when(svc.getIdentity(me)).thenReturn(id);
        when(svc.decryptPan(id)).thenReturn("ABCPS1234K");
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check(any())).thenThrow(new IllegalStateException("db down"));
        assertEquals("••••••234K", controller(svc, perm).getIdentity(me).pan());
        assertEquals("••••••234K", controller(svc, null).getIdentity(me).pan());
    }

    @Test void noIdentityOnRecordStaysEmpty() {
        UUID me = UUID.randomUUID();
        EmployeeProfileService svc = mock(EmployeeProfileService.class);
        when(svc.getIdentity(me)).thenReturn(null);
        assertNull(controller(svc, mock(PermissionChecker.class)).getIdentity(me));
    }

    @Test void maskKeepsShortAndEmptyValuesSafe() {
        assertNull(IdentityMask.lastFour(null));
        assertEquals("", IdentityMask.lastFour(""));
        assertEquals("•••", IdentityMask.lastFour("123"));
        assertEquals("••••••3921", IdentityMask.lastFour("100 482 3921"));
    }

    // ── BW-100: device in words ───────────────────────────────────────────

    @Test void deviceNames() {
        assertEquals("Chrome on Windows", LoginDevice.describe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"));
        assertEquals("Chrome on Windows", LoginDevice.describe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.7778.96 Safari/537.36"));
        assertEquals("Edge on Windows", LoginDevice.describe("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0"));
        assertEquals("Safari on Mac", LoginDevice.describe("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"));
        assertEquals("Firefox on Linux", LoginDevice.describe("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"));
        assertEquals("Android", LoginDevice.describe("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"));
        assertEquals("Android", LoginDevice.describe("okhttp/4.12.0"));
        assertEquals("iPhone", LoginDevice.describe("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"));
        assertEquals("Mobile app", LoginDevice.describe("Dart/3.4 (dart:io)"));
    }

    @Test void unknownDevicesSayNothing() {
        assertEquals("", LoginDevice.describe(null));
        assertEquals("", LoginDevice.describe(""));
        assertEquals("", LoginDevice.describe("node"));
        assertEquals("", LoginDevice.describe("curl/8.4.0"));
    }

    @Test void signInTimesAreIsoInstants() {
        java.time.Instant at = java.time.Instant.parse("2026-10-02T03:51:00Z");
        assertEquals("2026-10-02T03:51:00Z", EmployeeController.isoInstant(java.sql.Timestamp.from(at)));
        assertEquals("2026-10-02T03:51:00Z", EmployeeController.isoInstant(at));
        assertEquals("2026-10-02T03:51:00Z", EmployeeController.isoInstant(at.atOffset(java.time.ZoneOffset.ofHoursMinutes(5, 30))));
        assertEquals("", EmployeeController.isoInstant(null));
    }

    // ── BW-101: nominee total ─────────────────────────────────────────────

    private static EmployeeDependent dep(boolean nominee, Integer pct) {
        EmployeeDependent d = new EmployeeDependent();
        d.setName("x");
        d.setRelationship("Father");
        d.setNominee(nominee);
        d.setNomineePercentage(pct);
        return d;
    }

    @Test void sharesUpToHundredSave() {
        assertDoesNotThrow(() -> NomineeShares.check(List.of(dep(true, 50)), dep(true, 50)));
        assertDoesNotThrow(() -> NomineeShares.check(List.of(), dep(true, 100)));
        assertEquals(80, NomineeShares.total(List.of(dep(true, 50), dep(true, 30), dep(false, 40), dep(true, null))));
    }

    @Test void aShareAboveTheTotalIsRefusedWithTheRunningTotal() {
        HrmsException e = assertThrows(HrmsException.class, () -> NomineeShares.check(List.of(dep(true, 60), dep(true, 20)), dep(true, 30)));
        assertEquals("NOMINEE_SHARE_OVER_100", e.getErrorCode());
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertTrue(e.getMessage().contains("80%"), e.getMessage());
        assertTrue(e.getMessage().contains("up to 20%"), e.getMessage());
    }

    @Test void aFullTotalSaysSo() {
        HrmsException e = assertThrows(HrmsException.class, () -> NomineeShares.check(List.of(dep(true, 100)), dep(true, 10)));
        assertTrue(e.getMessage().contains("already add up to 100%"), e.getMessage());
    }

    @Test void nonNomineesAndExistingOverTotalsStillSave() {
        // Existing rows are never re-checked: a record already above 100 still takes a non-nominee.
        assertDoesNotThrow(() -> NomineeShares.check(List.of(dep(true, 70), dep(true, 60)), dep(false, null)));
        assertDoesNotThrow(() -> NomineeShares.check(List.of(dep(true, 100)), dep(true, null)));
        assertDoesNotThrow(() -> NomineeShares.check(List.of(dep(true, 100)), dep(true, 0)));
        assertDoesNotThrow(() -> NomineeShares.check(null, dep(true, 40)));
    }

    @Test void theControllerChecksBeforeSaving() {
        UUID emp = UUID.randomUUID();
        EmployeeProfileService svc = mock(EmployeeProfileService.class);
        when(svc.getDependents(emp)).thenReturn(List.of(dep(true, 90)));
        EmployeeProfileController c = controller(svc, mock(PermissionChecker.class));
        assertThrows(HrmsException.class, () -> c.addDependent(emp, dep(true, 20)));
        verify(svc, never()).addDependent(any(), any());
        EmployeeDependent ok = dep(true, 10);
        when(svc.addDependent(emp, ok)).thenReturn(ok);
        assertEquals(201, c.addDependent(emp, ok).getStatusCode().value());
    }
}
