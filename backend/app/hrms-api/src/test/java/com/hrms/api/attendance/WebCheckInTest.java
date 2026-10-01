package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.CheckInRequest;
import com.hrms.attendance.dto.CheckOutRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Web check-in (V143.53 redesign, BW-24) and "Anywhere" (BW-28), through the
 * real check-in endpoint: WEB is refused while the company switch is off or
 * the records don't accept WEB yet, and without the browser's location; the
 * zone rule is the one every punch meets (approved WFH days and "Anywhere"
 * lift it); there is no face check and no offline backdating on the web; and
 * a phone punch never consults the switch.
 */
class WebCheckInTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private final AttendanceService attendance = mock(AttendanceService.class);
    private final GeoValidationService geo = mock(GeoValidationService.class);
    private final AttendanceContextResolver contexts = mock(AttendanceContextResolver.class);
    private final AttendanceReviewService review = mock(AttendanceReviewService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private PunchRulesService rules;
    private AttendanceController controller;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(TENANT);
        rules = spy(new PunchRulesService(jdbc));
        controller = new AttendanceController(attendance, geo, contexts, mock(EmployeeRepository.class),
                mock(WorkforceDepartmentRepository.class), mock(LeaveRequestRepository.class));
        ReflectionTestUtils.setField(controller, "punchRules", rules);
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

    private static Jwt token() {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", EMP.toString()).claim("tenant_id", TENANT.toString())
                .claim("permissions", List.of("attendance.checkin.self")).build();
    }

    private static CheckInRequest web(double lat, double lon) {
        return new CheckInRequest(lat, lon, "c2VsZmll", "WEB", null, null, null, null, true, Instant.parse("2026-09-28T01:00:00Z"));
    }

    private void switchOn(boolean on) {
        doReturn(on).when(rules).webPunchAllowed(COMPANY);
        doReturn(true).when(rules).webMethodStorable();
    }

    private void zone(boolean inside) {
        when(geo.validate(any(), any(), any(), any(), anyInt()))
                .thenReturn(new GeoValidateResponse(inside, null, null, inside ? 20.0 : 900.0, inside ? "ok" : "You are 800 meters outside the office boundary."));
    }

    private void verifyNoPunch() {
        verify(attendance, never()).checkInJson(any(), any(), any(), any(), anyDouble(), anyDouble(), any(), any(), any(), any(),
                any(), any(), any(), anyBoolean(), anyBoolean(), any());
    }

    @Test void webIsRefusedWhileTheCompanySwitchIsOff() {
        switchOn(false);
        zone(true);
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(17.4, 78.4), token()));
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED, e.getErrorCode());
        verifyNoPunch();
    }

    @Test void webIsRefusedWhileTheRecordsDontAcceptWebYet() {
        doReturn(true).when(rules).webPunchAllowed(COMPANY);
        doReturn(false).when(rules).webMethodStorable();
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
    }

    @Test void webOutsideTheZoneIsRefusedLikeAnyPunch() {
        switchOn(true);
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        assertEquals("OUTSIDE_GEOFENCE",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(web(12.9, 77.6), token())).getErrorCode());
        verifyNoPunch();
    }

    @Test void webOnAnApprovedWfhDayIsAcceptedWithoutFaceOrBackdating() {
        switchOn(true);
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(true);
        controller.checkIn(web(12.9, 77.6), token());
        // no face image, the WEB method, the WFH day, and never the client's capture time
        verify(attendance).checkInJson(eq(EMP), eq(COMPANY), any(), any(), eq(12.9), eq(77.6), isNull(), eq("WEB"), any(), any(), any(),
                any(), any(), eq(true), eq(false), isNull());
        verify(attendance).effectivePunchInstant(isNull(), eq(false));
        verify(review, never()).flagOutsideGeofence(any(), any(), any());
    }

    @Test void anywhereLiftsTheZoneAndIsNotFlaggedForReview() {
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        doReturn(true).when(rules).allowAnywhere(EMP);
        CheckInRequest phone = new CheckInRequest(12.9, 77.6, "c2VsZmll", "FACE_RECOGNITION", null, null, null, null, false, null);
        controller.checkIn(phone, token());
        verify(attendance).checkInJson(eq(EMP), any(), any(), any(), anyDouble(), anyDouble(), eq("c2VsZmll"), eq("FACE_RECOGNITION"),
                any(), any(), any(), any(), any(), eq(false), eq(false), isNull());
        verify(review, never()).flagOutsideGeofence(any(), any(), any());
    }

    @Test void withoutAnywhereTheSamePhonePunchIsStillStopped() {
        zone(false);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        doReturn(false).when(rules).allowAnywhere(EMP);
        CheckInRequest phone = new CheckInRequest(12.9, 77.6, "c2VsZmll", "FACE_RECOGNITION", null, null, null, null, false, null);
        assertEquals("OUTSIDE_GEOFENCE",
                assertThrows(BusinessRuleException.class, () -> controller.checkIn(phone, token())).getErrorCode());
    }

    @Test void aPhonePunchNeverAsksTheWebSwitch() {
        zone(true);
        when(attendance.isApprovedWfhDay(eq(EMP), any())).thenReturn(false);
        CheckInRequest phone = new CheckInRequest(17.4, 78.4, "c2VsZmll", "FACE_RECOGNITION", null, null, null, null, false, null);
        controller.checkIn(phone, token());
        verify(rules, never()).assertWebPunch(any(), any(), any());
        verify(rules, never()).webPunchAllowed(any());
    }

    @Test void webCheckOutMeetsTheSameSwitch() {
        switchOn(false);
        CheckOutRequest out = new CheckOutRequest(17.4, 78.4, "WEB", null, null, null, null, false, null, null);
        assertEquals(PunchRulesService.WEB_PUNCH_NOT_ALLOWED,
                assertThrows(BusinessRuleException.class, () -> controller.checkOut(out, token())).getErrorCode());
        verify(attendance, never()).checkOut(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
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

    @Test void theSwitchReadsTheCompanysRow() {
        PunchRulesService real = new PunchRulesService(jdbc);
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Boolean.class), any(), any())).thenReturn(true);
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of(true));
        assertTrue(real.webPunchAllowed(COMPANY));
        when(jdbc.queryForList(contains("allow_web_punch FROM"), eq(Boolean.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of());
        assertFalse(real.webPunchAllowed(COMPANY), "no HR configuration row: off, the default");
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
