package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.CheckInRequest;
import com.hrms.attendance.dto.CheckOutRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Web check-in (V143.53 redesign, BW-24) and "Anywhere" (BW-28), through the
 * real check-in endpoint: web check-in is on by default and an admin can turn
 * it off; WEB is refused while it is off or the records don't accept WEB yet,
 * and without the browser's location; the zone rule is the one every punch
 * meets (approved WFH days and "Anywhere" lift it); the face scan must match
 * the person's enrolled face (the phone's face check, FaceService.verify) before
 * the punch, in and out; there is no offline backdating on the web; and a
 * phone punch never consults the switch or the web face check.
 */
class WebCheckInTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID LOGIN = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final String FACE = "c2VsZmll";

    private final AttendanceService attendance = mock(AttendanceService.class);
    private final GeoValidationService geo = mock(GeoValidationService.class);
    private final AttendanceContextResolver contexts = mock(AttendanceContextResolver.class);
    private final AttendanceReviewService review = mock(AttendanceReviewService.class);
    private final FaceService faces = mock(FaceService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private PunchRulesService rules;
    private AttendanceController controller;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(TENANT);
        rules = spy(new PunchRulesService(jdbc));
        controller = new AttendanceController(attendance, geo, contexts, mock(EmployeeRepository.class),
                mock(WorkforceDepartmentRepository.class), mock(LeaveRequestRepository.class));
        ReflectionTestUtils.setField(controller, "punchRules", rules);
        ReflectionTestUtils.setField(controller, "webPunchFace", new WebPunchFace(faces));
        ReflectionTestUtils.setField(controller, "reviewService", review);
        ReflectionTestUtils.setField(controller, "geofenceEnforce", true);
        when(contexts.resolve(EMP)).thenReturn(new AttendanceContextResolver.Context(
                EMP, COMPANY, UUID.randomUUID(), null, 17.4, 78.4, 100, "Head office"));
        when(attendance.effectivePunchInstant(any(), anyBoolean())).thenReturn(Instant.now());
        when(attendance.checkInJson(any(), any(), any(), any(), anyDouble(), anyDouble(), any(), any(), any(), any(), any(),
                any(), any(), anyBoolean(), anyBoolean(), any()))
                .thenReturn(new AttendanceDto(UUID.randomUUID(), "2026-09-28", "2026-09-28T03:40:00Z", null, "OFFICE", "ON_TIME",
                        "WEB", null, null, null, "Head office", null, null, 0, null, false));
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private static Jwt token(String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(LOGIN.toString())
                .claim("employee_id", EMP.toString()).claim("tenant_id", TENANT.toString())
                .claim("permissions", List.of(permissions)).build();
    }

    /** What every built-in role holds: punch yourself, and the phone's face check. */
    private static Jwt token() {
        return token("attendance.checkin.self", WebPunchFace.PERM_VERIFY);
    }

    private static CheckInRequest web(double lat, double lon) {
        return web(lat, lon, FACE);
    }

    private static CheckInRequest web(double lat, double lon, String face) {
        return new CheckInRequest(lat, lon, face, "WEB", null, null, null, null, true, Instant.parse("2026-09-28T01:00:00Z"));
    }

    private static CheckOutRequest webOut(String face) {
        return new CheckOutRequest(17.4, 78.4, "WEB", null, null, null, null, true, Instant.parse("2026-09-28T01:00:00Z"), null, face);
    }

    private void switchOn(boolean on) {
        doReturn(on).when(rules).webPunchAllowed(COMPANY);
        doReturn(true).when(rules).webMethodStorable();
    }

    private void zone(boolean inside) {
        when(geo.validate(any(), any(), any(), any(), anyInt()))
                .thenReturn(new GeoValidateResponse(inside, null, null, inside ? 20.0 : 900.0, inside ? "ok" : "You are 800 meters outside the office boundary."));
    }

    private void faceSays(HttpStatus status, String reason) {
        when(faces.verify(any(), any(), any(), any())).thenThrow(new ResponseStatusException(status, reason));
    }

    private void verifyNoPunch() {
        verify(attendance, never()).checkInJson(any(), any(), any(), any(), anyDouble(), anyDouble(), any(), any(), any(), any(),
                any(), any(), any(), anyBoolean(), anyBoolean(), any());
    }

    private void verifyNoCheckOut() {
        verify(attendance, never()).checkOut(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    // ── the switch, the location and the zone ───────────────────────────────

    @Test void webIsRefusedWhileTheCompanySwitchIsOff() {
        switchOn(false);
        zone(true);
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4), token()));
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED, e.getErrorCode());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    @Test void webIsRefusedWhileTheRecordsDontAcceptWebYet() {
        doReturn(true).when(rules).webPunchAllowed(COMPANY);
        doReturn(false).when(rules).webMethodStorable();
        zone(true);
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED,
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4), token())).getErrorCode());
        verifyNoPunch();
    }

    @Test void webIsRefusedWithoutTheFaceCheckOnTheServer() {
        ReflectionTestUtils.setField(controller, "webPunchFace", null);
        switchOn(true);
        zone(true);
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED,
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4), token())).getErrorCode());
        verifyNoPunch();
    }

    @Test void webNeedsTheBrowsersLocation() {
        switchOn(true);
        zone(true);
        assertEquals(PunchRulesService.LOCATION_REQUIRED,
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(0, 0), token())).getErrorCode());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    @Test void webOutsideTheZoneIsRefusedLikeAnyPunchBeforeTheFaceScan() {
        switchOn(true);
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        assertEquals("OUTSIDE_GEOFENCE",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(12.9, 77.6), token())).getErrorCode());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    @Test void alreadyCheckedInIsSaidBeforeTheFaceScan() {
        switchOn(true);
        zone(true);
        when(attendance.getTodayRecord(EMP)).thenReturn(Optional.of(new AttendanceDto(UUID.randomUUID(), "2026-09-28",
                "2026-09-28T03:40:00Z", null, "OFFICE", "ON_TIME", "WEB", null, null, null, null, null, null, 0, null, false)));
        assertEquals("ALREADY_CHECKED_IN",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4), token())).getErrorCode());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    // ── the face scan ────────────────────────────────────────────────────────

    @Test void webOnAnApprovedWfhDayIsAcceptedAfterTheFaceMatched() {
        switchOn(true);
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(true);
        controller.checkIn(web(12.9, 77.6), token());
        // the phone's face check, on the signed-in login, for a punch in, from the browser
        ArgumentCaptor<FaceDtos.VerifyRequest> sent = ArgumentCaptor.forClass(FaceDtos.VerifyRequest.class);
        verify(faces).verify(eq(TENANT), eq(LOGIN), sent.capture(), eq("PUNCH_IN"));
        assertEquals(FACE, sent.getValue().imageBase64());
        assertEquals(FaceDtos.Challenge.BLINK, sent.getValue().challengePerformed());
        assertEquals("Web browser", sent.getValue().deviceFingerprint());
        assertEquals(12.9, sent.getValue().latitude());
        // then the punch: the WEB method, the WFH day, no face on the record path, never the client's capture time
        verify(attendance).checkInJson(eq(EMP), eq(COMPANY), any(), any(), eq(12.9), eq(77.6), isNull(), eq("WEB"), any(), any(), any(),
                any(), any(), eq(true), eq(false), isNull());
        verify(attendance).effectivePunchInstant(isNull(), eq(false));
        verify(review, never()).flagOutsideGeofence(any(), any(), any());
    }

    @Test void webWithoutAFaceIsRefused() {
        switchOn(true);
        zone(true);
        assertEquals("FACE_IMAGE_REQUIRED",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4, " "), token())).getErrorCode());
        assertEquals("FACE_IMAGE_INVALID",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4, "data:image/jpeg;base64,xx"), token())).getErrorCode());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    @Test void aFaceThatDoesntMatchStopsThePunch() {
        switchOn(true);
        zone(true);
        faceSays(HttpStatus.FORBIDDEN, "FAIL_MATCH:That doesn't look like your enrolled face.");
        HrmsException e = assertThrows(HrmsException.class, () -> controller.checkIn(web(17.4, 78.4), token()));
        assertEquals("FAIL_MATCH", e.getErrorCode());
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertTrue(e.getMessage().contains("enrolled face"));
        verifyNoPunch();
    }

    @Test void noEnrolledFaceIsSaidAsSuch() {
        switchOn(true);
        zone(true);
        faceSays(HttpStatus.CONFLICT, "FACE_NOT_ENROLLED:You haven't enrolled your face yet. Please open Face Enrolment first.");
        HrmsException e = assertThrows(HrmsException.class, () -> controller.checkIn(web(17.4, 78.4), token()));
        assertEquals("FACE_NOT_ENROLLED", e.getErrorCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verifyNoPunch();
    }

    @Test void aLockedFaceCheckStaysLocked() {
        switchOn(true);
        zone(true);
        faceSays(HttpStatus.LOCKED, "FACE_LOCKED:Face verification is temporarily locked.");
        HrmsException e = assertThrows(HrmsException.class, () -> controller.checkIn(web(17.4, 78.4), token()));
        assertEquals("FACE_LOCKED", e.getErrorCode());
        assertEquals(HttpStatus.LOCKED, e.getStatus());
        verifyNoPunch();
    }

    @Test void webNeedsThePhonesFaceCheckPermission() {
        switchOn(true);
        zone(true);
        HrmsException e = assertThrows(HrmsException.class, () -> controller.checkIn(web(17.4, 78.4), token("attendance.checkin.self")));
        assertEquals("FACE_VERIFY_NOT_ALLOWED", e.getErrorCode());
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        verifyNoPunch();
        verifyNoInteractions(faces);
    }

    @Test void theBrowsersLabelGoesOnTheFaceLog() {
        switchOn(true);
        zone(true);
        CheckInRequest labelled = new CheckInRequest(17.4, 78.4, FACE, "WEB", null, null, "Web · Chrome on Windows", null, false, null);
        controller.checkIn(labelled, token());
        ArgumentCaptor<FaceDtos.VerifyRequest> sent = ArgumentCaptor.forClass(FaceDtos.VerifyRequest.class);
        verify(faces).verify(any(), any(), sent.capture(), eq("PUNCH_IN"));
        assertEquals("Web · Chrome on Windows", sent.getValue().deviceFingerprint());
    }

    // ── "Anywhere" and the phone ─────────────────────────────────────────────

    @Test void anywhereLiftsTheZoneAndIsNotFlaggedForReview() {
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        doReturn(true).when(rules).allowAnywhere(EMP);
        CheckInRequest phone = new CheckInRequest(12.9, 77.6, FACE, "FACE_RECOGNITION", null, null, null, null, false, null);
        controller.checkIn(phone, token());
        verify(attendance).checkInJson(eq(EMP), any(), any(), any(), anyDouble(), anyDouble(), eq(FACE), eq("FACE_RECOGNITION"),
                any(), any(), any(), any(), any(), eq(false), eq(false), isNull());
        verify(review, never()).flagOutsideGeofence(any(), any(), any());
    }

    @Test void withoutAnywhereTheSamePhonePunchIsStillStopped() {
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        doReturn(false).when(rules).allowAnywhere(EMP);
        CheckInRequest phone = new CheckInRequest(12.9, 77.6, FACE, "FACE_RECOGNITION", null, null, null, null, false, null);
        assertEquals("OUTSIDE_GEOFENCE",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(phone, token())).getErrorCode());
    }

    @Test void aPhonePunchNeverAsksTheWebSwitchOrTheWebFaceCheck() {
        zone(true);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        CheckInRequest phone = new CheckInRequest(17.4, 78.4, FACE, "FACE_RECOGNITION", null, null, null, null, false, null);
        controller.checkIn(phone, token("attendance.checkin.self"));
        verify(rules, never()).assertWebPunch(any(), any(), any());
        verify(rules, never()).webPunchAllowed(any());
        verifyNoInteractions(faces);
    }

    @Test void aPhoneCheckOutIsUnchanged() {
        CheckOutRequest phone = new CheckOutRequest(17.4, 78.4, "FACE_RECOGNITION", null, null, null, null, false, null, null, null);
        controller.checkOut(phone, token("attendance.checkin.self"));
        verify(attendance).checkOut(eq(EMP), eq(17.4), eq(78.4), eq("FACE_RECOGNITION"), any(), any(), any(), eq(false), isNull());
        verify(rules, never()).webPunchAllowed(any());
        verifyNoInteractions(faces);
    }

    // ── web check-out ────────────────────────────────────────────────────────

    @Test void webCheckOutMeetsTheSameSwitch() {
        switchOn(false);
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED,
                assertThrows(BusinessRuleException.class, () -> controller.checkOut(webOut(FACE), token())).getErrorCode());
        verifyNoCheckOut();
        verifyNoInteractions(faces);
    }

    @Test void webCheckOutScansTheFaceThenPunches() {
        switchOn(true);
        when(attendance.openRecord(eq(EMP), any())).thenReturn(Optional.of(new AttendanceRecord()));
        controller.checkOut(webOut(FACE), token());
        verify(faces).verify(eq(TENANT), eq(LOGIN), any(), eq("PUNCH_OUT"));
        // the WEB method, and never the client's capture time
        verify(attendance).checkOut(eq(EMP), eq(17.4), eq(78.4), eq("WEB"), any(), any(), any(), eq(false), isNull());
    }

    @Test void webCheckOutWithAFaceThatDoesntMatchIsRefused() {
        switchOn(true);
        when(attendance.openRecord(eq(EMP), any())).thenReturn(Optional.of(new AttendanceRecord()));
        faceSays(HttpStatus.FORBIDDEN, "FAIL_LIVENESS:We couldn't confirm a live face.");
        assertEquals("FAIL_LIVENESS",
                assertThrows(HrmsException.class, () -> controller.checkOut(webOut(FACE), token())).getErrorCode());
        verifyNoCheckOut();
    }

    @Test void webCheckOutWithoutAFaceIsRefused() {
        switchOn(true);
        when(attendance.openRecord(eq(EMP), any())).thenReturn(Optional.of(new AttendanceRecord()));
        assertEquals("FACE_IMAGE_REQUIRED",
                assertThrows(BusinessRuleException.class, () -> controller.checkOut(webOut(null), token())).getErrorCode());
        verifyNoCheckOut();
        verifyNoInteractions(faces);
    }

    @Test void webCheckOutWithNothingOpenIsRefusedBeforeTheFaceScan() {
        switchOn(true);
        when(attendance.openRecord(eq(EMP), any())).thenReturn(Optional.empty());
        assertEquals("NOT_CHECKED_IN",
                assertThrows(BusinessRuleException.class, () -> controller.checkOut(webOut(FACE), token())).getErrorCode());
        when(attendance.getTodayRecord(EMP)).thenReturn(Optional.of(new AttendanceDto(UUID.randomUUID(), "2026-09-28",
                "2026-09-28T03:40:00Z", "2026-09-28T12:40:00Z", "OFFICE", "ON_TIME", "WEB", "WEB", 9.0, null, null, null, null, 0, null, false)));
        assertEquals("ALREADY_CHECKED_OUT",
                assertThrows(BusinessRuleException.class, () -> controller.checkOut(webOut(FACE), token())).getErrorCode());
        verifyNoCheckOut();
        verifyNoInteractions(faces);
    }

    // ── WebPunchFace on its own ──────────────────────────────────────────────

    @Test void everyFaceRefusalKeepsItsStatusAndCode() {
        HrmsException e = WebPunchFace.refusal(new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "FACE_WORKER_UNAVAILABLE:down"));
        assertEquals("FACE_WORKER_UNAVAILABLE", e.getErrorCode());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertFalse(e.getMessage().contains("phone"), "written for a browser");
        HrmsException unknown = WebPunchFace.refusal(new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SOMETHING_NEW:Plain words."));
        assertEquals("SOMETHING_NEW", unknown.getErrorCode());
        assertEquals("Plain words.", unknown.getMessage());
        assertEquals("FACE_CHECK_FAILED", WebPunchFace.refusal(new ResponseStatusException(HttpStatus.FORBIDDEN)).getErrorCode());
    }

    // ── PunchRulesService on its own ─────────────────────────────────────────

    @Test void theWebMethodIsSpelledAsTheServiceMapsIt() {
        assertTrue(PunchRulesService.isWeb("WEB"));
        assertTrue(PunchRulesService.isWeb("web"));
        assertFalse(PunchRulesService.isWeb(null));
        assertFalse(PunchRulesService.isWeb("FACE_RECOGNITION"));
        assertFalse(PunchRulesService.isWeb("MANUAL"));
    }

    @Test void aLocationMustBeReal() {
        assertTrue(PunchRulesService.hasLocation(17.4, 78.4));
        assertFalse(PunchRulesService.hasLocation(0.0, 0.0), "the old web hook's default");
        assertFalse(PunchRulesService.hasLocation(null, 78.4));
        assertFalse(PunchRulesService.hasLocation(91.0, 78.4));
        assertFalse(PunchRulesService.hasLocation(17.4, Double.NaN));
    }

    @Test void theSwitchReadsOffWhenTheColumnIsMissing() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Boolean.class), any(), any())).thenReturn(false);
        assertFalse(real.webPunchAllowed(COMPANY));
        verify(jdbc, never()).queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), any(), any());
    }

    @Test void theSwitchReadsTheCompanysRowAndIsOnWithoutOne() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Boolean.class), any(), any())).thenReturn(true);
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of(true));
        assertTrue(real.webPunchAllowed(COMPANY));
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of(false));
        assertFalse(real.webPunchAllowed(COMPANY), "an admin turned it off");
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of());
        assertTrue(real.webPunchAllowed(COMPANY), "no HR configuration row: on, the default");
    }

    @Test void theSettingIsOnWithoutARow() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("org.companies"), eq(Integer.class), any(), any())).thenReturn(1);
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), any(), any())).thenReturn(List.of());
        assertTrue(real.setting(COMPANY).allowWebPunch());
    }

    @Test void turningItOffSticksForACompanyWithoutARow() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("org.companies"), eq(Integer.class), any(), any())).thenReturn(1);
        assertFalse(real.save(COMPANY, false).allowWebPunch());
        // an upsert, so a company that never saved HR configuration gets its row (switched off)
        verify(jdbc).update(argThat((String sql) -> sql.contains("INSERT INTO settings.hr_configuration") && sql.contains("ON CONFLICT")),
                eq(TENANT), eq(COMPANY), eq(false));
        assertTrue(real.save(COMPANY, true).allowWebPunch());
        verify(jdbc).update(argThat((String sql) -> sql.contains("INSERT INTO settings.hr_configuration")), eq(TENANT), eq(COMPANY), eq(true));
    }

    @Test void anywhereIsOffWithoutItsTable() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class), eq("hrms.employee_punch_rules"))).thenReturn(false);
        assertFalse(real.allowAnywhere(EMP));
        verify(jdbc, never()).queryForList(contains("employee_punch_rules WHERE"), eq(Boolean.class), any(), any());
    }

    @Test void theSettingAnswersFeatureNotReadyWithoutTheColumn() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("org.companies"), eq(Integer.class), any(), any())).thenReturn(1);
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), any(), any()))
                .thenThrow(new BadSqlGrammarException("read", "SELECT allow_web_punch", new SQLException("column does not exist", "42703")));
        FeatureNotReady e = assertThrows(FeatureNotReady.class, () -> real.setting(COMPANY));
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());
        assertEquals(503, e.getStatus().value());
    }

    @Test void theRuleAnswersFeatureNotReadyWithoutTheTable() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("hrms.employees"), eq(Integer.class), any(), any())).thenReturn(1);
        when(jdbc.query(contains("employee_punch_rules"), any(org.springframework.jdbc.core.RowMapper.class), any(), any()))
                .thenThrow(new BadSqlGrammarException("read", "SELECT", new SQLException("relation does not exist", "42P01")));
        assertEquals("FEATURE_NOT_READY", assertThrows(FeatureNotReady.class, () -> real.rule(EMP)).getErrorCode());
    }
}
