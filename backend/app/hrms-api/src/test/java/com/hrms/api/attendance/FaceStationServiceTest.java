package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import com.unifiedtree.auth.service.JwtService;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Face station (V143.95): a station's sign-in can only punch, only people of its
 * own branch, only while the station is switched on; a match that isn't certain
 * is saved as needing the manager's approval, on the same review list where an
 * approval keeps it and a rejection stops it counting.
 */
class FaceStationServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID BRANCH = UUID.randomUUID();
    private static final UUID OTHER_BRANCH = UUID.randomUUID();
    private static final UUID STATION = UUID.randomUUID();

    @AfterEach void clear() {
        SecurityContextHolder.clearContext();
    }

    private static Jwt station() {
        return Jwt.withTokenValue("s").header("alg", "none").subject(STATION.toString())
                .claim("token_type", "station").claim("station_id", STATION.toString()).claim("tenant_id", TENANT.toString())
                .claim("roles", List.of("FACE_STATION")).claim("permissions", List.of("attendance.station.punch")).build();
    }

    private static Jwt person(UUID employeeId, String... permissions) {
        return Jwt.withTokenValue("p").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("tenant_id", TENANT.toString())
                .claim("permissions", List.of(permissions)).build();
    }

    private static Employee employee(String first, UUID branchId, EmploymentStatus status) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName("Kumar");
        e.setEmployeeCode("EMP-" + first.toUpperCase());
        e.setCompanyId(COMPANY);
        e.setBranchId(branchId);
        e.setEmploymentStatus(status);
        return e;
    }

    private static FaceStations.Station row(String status) {
        return new FaceStations.Station(STATION, COMPANY, BRANCH, "Hyderabad office", "Front desk", status,
                "Hema Kumar", Instant.now(), null, null, null, null, null, 0, 0);
    }

    // ── the rules on their own ───────────────────────────────────────────────

    @Test void onlyAStationTokenIsAStationAndAStationNeverManagesStations() {
        assertTrue(FaceStationService.isStationToken(station()));
        assertFalse(FaceStationService.isStationToken(person(UUID.randomUUID(), "attendance.station.punch")));
        assertFalse(FaceStationService.canManage(station()));
        assertTrue(FaceStationService.canManage(person(UUID.randomUUID(), "attendance.policy.manage", "attendance.assisted_punch.any")));
        // Both permissions are needed: attendance settings alone, or punching for anyone alone, is not enough.
        assertFalse(FaceStationService.canManage(person(UUID.randomUUID(), "attendance.policy.manage")));
        assertFalse(FaceStationService.canManage(person(UUID.randomUUID(), "attendance.assisted_punch.any")));
    }

    @Test void someoneWorksAtTheStationsBranchByTheirBranchOrTheCompanyDefault() {
        assertTrue(FaceStationService.worksAt(employee("Ravi", BRANCH, EmploymentStatus.ACTIVE), COMPANY, BRANCH, OTHER_BRANCH));
        assertFalse(FaceStationService.worksAt(employee("Sita", OTHER_BRANCH, EmploymentStatus.ACTIVE), COMPANY, BRANCH, BRANCH));
        // No branch of their own: they belong to the company's default branch, as the punch's work area says.
        assertTrue(FaceStationService.worksAt(employee("Anil", null, EmploymentStatus.ACTIVE), COMPANY, BRANCH, BRANCH));
        assertFalse(FaceStationService.worksAt(employee("Anil", null, EmploymentStatus.ACTIVE), COMPANY, BRANCH, OTHER_BRANCH));
        Employee elsewhere = employee("Mala", BRANCH, EmploymentStatus.ACTIVE);
        elsewhere.setCompanyId(UUID.randomUUID());
        assertFalse(FaceStationService.worksAt(elsewhere, COMPANY, BRANCH, BRANCH));
        assertFalse(FaceStationService.worksAt(null, COMPANY, BRANCH, BRANCH));
    }

    @Test void anythingShortOfAHighMatchNeedsTheManagersApprovalAndIsOnTheReviewList() {
        assertFalse(FaceStationService.needsApproval("HIGH"));
        for (String bucket : new String[]{"MEDIUM", "LOW", "UNKNOWN", null}) {
            assertTrue(FaceStationService.needsApproval(bucket), String.valueOf(bucket));
        }
        // The review list ("To check") shows exactly the passed MEDIUM / LOW matches as waiting.
        assertEquals("REVIEW", AttendanceReviewService.faceStatus("PASS", "MEDIUM", null));
        assertEquals("OK", AttendanceReviewService.faceStatus("PASS", "HIGH", null));
        // Approved keeps it; rejected is flagged (and the day no longer counts it: EffectiveDayStatusService).
        assertEquals("CONFIRMED", AttendanceReviewService.faceStatus("PASS", "MEDIUM", "CONFIRMED"));
        assertEquals("FLAGGED", AttendanceReviewService.faceStatus("PASS", "MEDIUM", "REJECTED"));
    }

    @Test void namesAndSearchesAreTrimmedAndTooShortSearchesListNobody() {
        assertEquals("Front desk", FaceStationService.cleanName("  Front \n desk "));
        assertNull(FaceStationService.cleanName("x"));
        assertNull(FaceStationService.cleanName("y".repeat(81)));
        assertNull(FaceStationService.searchText(" a "));
        assertNull(FaceStationService.searchText(null));
        assertEquals("ra", FaceStationService.searchText(" RA "));
        assertTrue(FaceStationService.faceReady("ENROLLED"));
        assertFalse(FaceStationService.faceReady("NOT_ENROLLED"));
        assertFalse(FaceStationService.faceReady("NO_LOGIN"));
    }

    @Test void faceRefusalsSpeakToThePersonAtTheStationAndKeepTheirStatus() {
        HrmsException mismatch = FaceStationService.faceRefusal(
                new ResponseStatusException(HttpStatus.FORBIDDEN, "FAIL_MATCH:That doesn't look like your enrolled face."), "Ravi Kumar");
        assertEquals(HttpStatus.FORBIDDEN, mismatch.getStatus());
        assertEquals("FAIL_MATCH", mismatch.getErrorCode());
        assertTrue(mismatch.getMessage().contains("Ravi Kumar"));
        HrmsException locked = FaceStationService.faceRefusal(
                new ResponseStatusException(HttpStatus.LOCKED, "FACE_LOCKED:Locked."), "Ravi Kumar");
        assertEquals(HttpStatus.LOCKED, locked.getStatus());
    }

    // ── the station's sign-in can only reach the station endpoints ──────────

    private static int filter(Jwt jwt, String path) throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        new StationScopeFilter().doFilter(req, res, chain);
        boolean passed = !mockingDetails(chain).getInvocations().isEmpty();
        return passed ? 200 : res.getStatus();
    }

    @Test void aStationTokenIsRefusedEverywhereButTheStationEndpoints() throws Exception {
        for (String path : List.of("/v1/employees", "/v1/employees/me", "/v1/attendance/today", "/v1/attendance/stations",
                "/v1/attendance/assisted-punch/eligible", "/v1/payroll/runs", "/v1/me/dashboard", "/v1/notifications",
                "/v1/canonical-auth/refresh", "/v1/attendance/station", "/v1/attendance/station/../employees")) {
            assertEquals(403, filter(station(), path), path);
        }
        for (String path : List.of("/v1/attendance/station/me", "/v1/attendance/station/people", "/v1/attendance/station/punch",
                "/v1/attendance/station/renew")) {
            assertEquals(200, filter(station(), path), path);
        }
    }

    @Test void peoplesSignInsAreNotTouchedByTheStationFilter() throws Exception {
        assertEquals(200, filter(person(UUID.randomUUID(), "hrms.employee.read"), "/v1/employees"));
        assertEquals(200, filter(person(UUID.randomUUID()), "/v1/attendance/station/me")); // the controller refuses it instead
    }

    // ── the service ──────────────────────────────────────────────────────────

    private final FaceStations stations = mock(FaceStations.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final WorkforceBranchRepository branches = mock(WorkforceBranchRepository.class);
    private final AssistedPunchService assisted = mock(AssistedPunchService.class);
    private final AssistedPunchRecorder recorder = mock(AssistedPunchRecorder.class);
    private final AttendanceService attendance = mock(AttendanceService.class);
    private final AttendanceContextResolver contexts = mock(AttendanceContextResolver.class);
    private final GeoValidationService geo = mock(GeoValidationService.class);
    private final FaceService face = mock(FaceService.class);
    private final JwtService jwt = new JwtService("a-test-secret-that-is-long-enough-for-hs256!", "unifiedtree", 720, 7);

    private FaceStationService service() {
        FaceStationService s = new FaceStationService(stations, employees, branches, mock(WorkforceDepartmentRepository.class),
                assisted, recorder, attendance, contexts, geo, face, jwt, mock(PlatformTransactionManager.class));
        ReflectionTestUtils.setField(s, "geofenceEnforce", true);
        return s;
    }

    private FaceStationService.PunchRequest punch(UUID employeeId) {
        return new FaceStationService.PunchRequest(employeeId, "CHECK_IN", "QUJD", FaceDtos.Challenge.BLINK, 17.36, 78.53, 12.0, "Tab A8");
    }

    private void onAndEnrolled(Employee e, UUID login) {
        when(stations.find(STATION)).thenReturn(row("ACTIVE"));
        when(employees.findById(e.getId())).thenReturn(Optional.of(e));
        when(assisted.faceLoginOf(TENANT, e.getId())).thenReturn(login);
        when(assisted.companyRequiresGeofence(any())).thenReturn(true);
        when(face.getStatus(TENANT, login)).thenReturn(new FaceDtos.EnrollmentStatusResponse(
                FaceDtos.EnrollmentStatus.ACTIVE, 3, 3, List.of(), 0, false, null, null));
        when(attendance.getTodayRecord(e.getId())).thenReturn(Optional.empty());
        when(contexts.resolve(e.getId())).thenReturn(new AttendanceContextResolver.Context(
                e.getId(), COMPANY, BRANCH, null, 17.36, 78.53, 100, "Hyderabad office"));
        when(geo.validate(any(), any(), any(), any(), anyInt())).thenReturn(new GeoValidateResponse(true, BRANCH, "Hyderabad office", 8.0, "ok"));
    }

    @Test void aPersonsSignInCannotUseTheStationEndpoints() {
        HrmsException e = assertThrows(HrmsException.class,
                () -> service().punch(person(UUID.randomUUID(), "attendance.station.punch"), punch(UUID.randomUUID())));
        assertEquals("STATION_ONLY", e.getErrorCode());
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        verifyNoInteractions(face, recorder);
    }

    @Test void aRevokedStationStopsAtItsNextRequest() {
        when(stations.find(STATION)).thenReturn(row("REVOKED"));
        for (Runnable call : List.<Runnable>of(() -> service().me(station()), () -> service().people(station(), "ravi"),
                () -> service().punch(station(), punch(UUID.randomUUID())), () -> service().renew(station()))) {
            HrmsException e = assertThrows(HrmsException.class, call::run);
            assertEquals("STATION_REVOKED", e.getErrorCode());
            assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        }
        verifyNoInteractions(face, recorder, employees);
    }

    @Test void theSearchListsOnlyWorkingPeopleOfTheStationsBranchAndNeverTheWholeBranch() {
        when(stations.find(STATION)).thenReturn(row("ACTIVE"));
        Branch hq = new Branch();
        hq.setId(BRANCH);
        hq.setHeadquarters(true);
        hq.setActive(true);
        when(branches.findAllByCompanyIdAndActiveTrueOrderByNameAsc(COMPANY)).thenReturn(List.of(hq));
        Employee here = employee("Ravi", BRANCH, EmploymentStatus.ACTIVE);
        Employee noBranch = employee("Rani", null, EmploymentStatus.PROBATION);
        Employee there = employee("Raju", OTHER_BRANCH, EmploymentStatus.ACTIVE);
        Employee gone = employee("Rama", BRANCH, EmploymentStatus.EXITED);
        when(employees.findActiveByCompany(COMPANY)).thenReturn(List.of(here, noBranch, there, gone));
        when(assisted.faceStatuses(eq(TENANT), anyList())).thenReturn(Map.of(here.getId(), "ENROLLED"));

        FaceStationService.PeopleList list = service().people(station(), "ra");
        assertEquals(List.of("Rani Kumar", "Ravi Kumar"), list.people().stream().map(FaceStationService.StationPerson::fullName).toList());
        assertTrue(list.people().stream().filter(p -> p.fullName().equals("Ravi Kumar")).findFirst().orElseThrow().faceReady());
        assertFalse(list.people().stream().filter(p -> p.fullName().equals("Rani Kumar")).findFirst().orElseThrow().faceReady());

        FaceStationService.PeopleList tooShort = service().people(station(), "r");
        assertTrue(tooShort.people().isEmpty());
        assertNotNull(tooShort.hint());
    }

    @Test void theSearchStopsAtEightPeople() {
        when(stations.find(STATION)).thenReturn(row("ACTIVE"));
        List<Employee> many = new ArrayList<>();
        for (int i = 0; i < 12; i++) many.add(employee("Ravi" + (char) ('a' + i), BRANCH, EmploymentStatus.ACTIVE));
        when(employees.findActiveByCompany(COMPANY)).thenReturn(many);
        when(assisted.faceStatuses(eq(TENANT), anyList())).thenReturn(Map.of());
        FaceStationService.PeopleList list = service().people(station(), "ravi");
        assertEquals(8, list.people().size());
        assertTrue(list.truncated());
    }

    @Test void someoneFromAnotherBranchIsRefusedBeforeTheirFaceIsChecked() {
        Employee there = employee("Raju", OTHER_BRANCH, EmploymentStatus.ACTIVE);
        onAndEnrolled(there, UUID.randomUUID());
        HrmsException e = assertThrows(HrmsException.class, () -> service().punch(station(), punch(there.getId())));
        assertEquals("STATION_OTHER_BRANCH", e.getErrorCode());
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        verifyNoInteractions(face, recorder, geo);
    }

    @Test void aFaceThatDoesNotMatchNeverPunches() {
        Employee ravi = employee("Ravi", BRANCH, EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        onAndEnrolled(ravi, login);
        when(face.verify(eq(TENANT), eq(login), any(), eq("PUNCH_IN")))
                .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "FAIL_MATCH:No."));
        HrmsException e = assertThrows(HrmsException.class, () -> service().punch(station(), punch(ravi.getId())));
        assertEquals("FAIL_MATCH", e.getErrorCode());
        verifyNoInteractions(recorder);
        verify(stations, never()).recordPunch(any(), any(), any(), any(), any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test void outsideTheWorkAreaIsRefusedBeforeTheFaceIsChecked() {
        Employee ravi = employee("Ravi", BRANCH, EmploymentStatus.ACTIVE);
        onAndEnrolled(ravi, UUID.randomUUID());
        when(geo.validate(any(), any(), any(), any(), anyInt())).thenReturn(new GeoValidateResponse(false, BRANCH, "Hyderabad office", 4000.0, "far"));
        HrmsException e = assertThrows(HrmsException.class, () -> service().punch(station(), punch(ravi.getId())));
        assertEquals("OUTSIDE_GEOFENCE", e.getErrorCode());
        verify(face, never()).verify(any(), any(), any(), any());
        verifyNoInteractions(recorder);
    }

    private AttendanceDto checkedIn() {
        return new AttendanceDto(UUID.randomUUID(), "2026-10-06", "2026-10-06T03:44:00Z", null, "OFFICE", "ON_TIME",
                "FACE_RECOGNITION", null, null, null, "Hyderabad office", null, null, 0, null, false);
    }

    @Test void anUncertainMatchIsRecordedWithTheStationAndWaitsForTheManager() {
        Employee ravi = employee("Ravi", BRANCH, EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        UUID faceEvent = UUID.randomUUID();
        onAndEnrolled(ravi, login);
        when(face.verify(eq(TENANT), eq(login), any(), eq("PUNCH_IN"))).thenReturn(new FaceDtos.VerifyResponse(true, null, "MEDIUM", 0.9));
        when(recorder.latestPassedFaceEvent(TENANT, login, "PUNCH_IN")).thenReturn(faceEvent);
        AttendanceDto dto = checkedIn();
        when(recorder.checkIn(eq(TENANT), any(), eq("QUJD"), eq(false), any())).thenReturn(dto);

        FaceStationService.PunchResult out = service().punch(station(), punch(ravi.getId()));
        assertTrue(out.needsApproval());
        assertEquals("Ravi Kumar", out.employeeName());
        assertEquals("EMP-RAVI", out.employeeCode());
        assertEquals("Front desk", out.stationName());
        // "Punched by" the station (no person), on this device, with the face check that cleared it.
        verify(recorder).checkIn(eq(TENANT), argThat(t -> t.employeeId().equals(ravi.getId())), eq("QUJD"), eq(false),
                argThat(by -> by.userId() == null && by.employeeId() == null && "Front desk (station)".equals(by.name())
                        && "Station · Front desk".equals(by.deviceId()) && faceEvent.equals(by.faceEventId())));
        // The face check itself is labelled with the station too (the Face tab's device column).
        verify(face).verify(eq(TENANT), eq(login), argThat(r -> "Station · Front desk".equals(r.deviceFingerprint())), eq("PUNCH_IN"));
        // Every station punch records the station.
        verify(stations).recordPunch(eq(TENANT), eq(STATION), eq(dto.id()), eq(ravi.getId()), any(), eq("CHECK_IN"), any(),
                eq(faceEvent), eq("MEDIUM"), eq(true));
    }

    @Test void aCertainMatchIsRecordedWithoutWaiting() {
        Employee ravi = employee("Ravi", BRANCH, EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        onAndEnrolled(ravi, login);
        when(face.verify(eq(TENANT), eq(login), any(), eq("PUNCH_IN"))).thenReturn(new FaceDtos.VerifyResponse(true, null, "HIGH", 0.95));
        when(recorder.checkIn(eq(TENANT), any(), eq("QUJD"), eq(false), any())).thenReturn(checkedIn());
        FaceStationService.PunchResult out = service().punch(station(), punch(ravi.getId()));
        assertFalse(out.needsApproval());
        verify(stations).recordPunch(eq(TENANT), eq(STATION), any(), eq(ravi.getId()), any(), eq("CHECK_IN"), any(), any(), eq("HIGH"), eq(false));
    }

    @Test void startingAStationOnADeviceGivesAStationOnlyTokenAndOnlyForAnActiveStation() {
        Employee hr = employee("Hema", BRANCH, EmploymentStatus.ACTIVE);
        when(employees.findById(hr.getId())).thenReturn(Optional.of(hr));
        Jwt admin = person(hr.getId(), "attendance.policy.manage", "attendance.assisted_punch.any");
        when(stations.find(STATION)).thenReturn(row("ACTIVE"));
        FaceStationService.DeviceSession session = service().startOnDevice(admin, STATION);
        io.jsonwebtoken.Claims claims = jwt.parseAndValidate(session.token());
        assertEquals("station", claims.get("token_type"));
        assertEquals(STATION.toString(), claims.get("station_id"));
        assertEquals(TENANT.toString(), claims.get("tenant_id"));
        assertEquals(List.of("attendance.station.punch"), claims.get("permissions"));
        assertNull(claims.get("employee_id"));
        assertNull(claims.get("email"));
        assertTrue(session.expiresAt().isBefore(Instant.now().plus(Duration.ofDays(31))));
        verify(stations).markStarted(STATION, "Hema Kumar");

        when(stations.find(STATION)).thenReturn(row("REVOKED"));
        assertEquals("STATION_REVOKED", assertThrows(HrmsException.class, () -> service().startOnDevice(admin, STATION)).getErrorCode());
    }

    @Test void onlyAdminsOfTheStationsCompanyManageIt() {
        Employee hr = employee("Hema", BRANCH, EmploymentStatus.ACTIVE);
        hr.setCompanyId(UUID.randomUUID()); // another company
        when(employees.findById(hr.getId())).thenReturn(Optional.of(hr));
        when(stations.find(STATION)).thenReturn(row("ACTIVE"));
        Jwt admin = person(hr.getId(), "attendance.policy.manage", "attendance.assisted_punch.any");
        assertThrows(com.hrms.core.exception.ResourceNotFoundException.class, () -> service().revoke(admin, STATION));
        verify(stations, never()).revoke(any(), any(), any());
        // A station can't manage stations, nor can someone with only one of the two permissions.
        assertEquals("STATION_NOT_ALLOWED", assertThrows(HrmsException.class, () -> service().list(station())).getErrorCode());
        assertEquals("STATION_NOT_ALLOWED", assertThrows(HrmsException.class,
                () -> service().list(person(hr.getId(), "attendance.policy.manage"))).getErrorCode());
    }

    @Test void aStationThatPunchedSomeoneIsKeptAsARecord() {
        Employee hr = employee("Hema", BRANCH, EmploymentStatus.ACTIVE);
        when(employees.findById(hr.getId())).thenReturn(Optional.of(hr));
        when(stations.find(STATION)).thenReturn(row("REVOKED"));
        when(stations.punchCount(STATION)).thenReturn(3);
        Jwt admin = person(hr.getId(), "attendance.policy.manage", "attendance.assisted_punch.any");
        assertEquals("STATION_HAS_PUNCHES", assertThrows(HrmsException.class, () -> service().delete(admin, STATION)).getErrorCode());
        verify(stations, never()).delete(any());
    }
}
