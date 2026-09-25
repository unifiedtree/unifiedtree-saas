package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Assisted face punch (V143.40): who may punch for whom, and in what order the
 * server checks it — the permission and scope first, then the face enrolment,
 * the work area and only then the face itself.
 */
class AssistedPunchScopeTest {

    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID TENANT = UUID.randomUUID();

    private static Jwt token(UUID employeeId, String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("tenant_id", TENANT.toString())
                .claim("permissions", List.of(permissions)).build();
    }

    private static Employee person(String first, EmploymentStatus status) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName("Kumar");
        e.setCompanyId(COMPANY);
        e.setEmploymentStatus(status);
        return e;
    }

    // ── scope from the token ─────────────────────────────────────────────────

    @Test void theScopeComesFromThePermissionsAndAnyoneWins() {
        UUID me = UUID.randomUUID();
        assertEquals(AssistedPunchService.Scope.ANY, AssistedPunchService.scopeOf(token(me, AssistedPunchService.PERM_ANY)));
        assertEquals(AssistedPunchService.Scope.ANY,
                AssistedPunchService.scopeOf(token(me, AssistedPunchService.PERM_TEAM, AssistedPunchService.PERM_ANY)));
        assertEquals(AssistedPunchService.Scope.TEAM, AssistedPunchService.scopeOf(token(me, AssistedPunchService.PERM_TEAM)));
        // A role name or the team attendance permission alone grants nothing.
        assertEquals(AssistedPunchService.Scope.NONE, AssistedPunchService.scopeOf(token(me, "attendance.team.read", "attendance.workforce.admin")));
    }

    // ── who may be punched for ───────────────────────────────────────────────

    @Test void aManagerPunchesOnlyForTheirTeam() {
        UUID manager = UUID.randomUUID();
        Employee report = person("Ravi", EmploymentStatus.ACTIVE);
        Employee outsider = person("Sita", EmploymentStatus.ACTIVE);
        Set<UUID> team = Set.of(report.getId());
        assertNull(AssistedPunchService.refusal(AssistedPunchService.Scope.TEAM, manager, COMPANY, report, team));
        HrmsException refused = AssistedPunchService.refusal(AssistedPunchService.Scope.TEAM, manager, COMPANY, outsider, team);
        assertNotNull(refused);
        assertEquals(HttpStatus.FORBIDDEN, refused.getStatus());
        assertEquals("ASSISTED_PUNCH_NOT_IN_TEAM", refused.getErrorCode());
        assertTrue(refused.getMessage().contains("Sita Kumar"));
    }

    @Test void anyoneMeansAnyoneWorkingInTheCallersCompany() {
        UUID hr = UUID.randomUUID();
        Employee anyone = person("Ravi", EmploymentStatus.PROBATION);
        assertNull(AssistedPunchService.refusal(AssistedPunchService.Scope.ANY, hr, COMPANY, anyone, Set.of()));
        Employee elsewhere = person("Anil", EmploymentStatus.ACTIVE);
        elsewhere.setCompanyId(UUID.randomUUID());
        assertEquals("ASSISTED_PUNCH_OTHER_COMPANY",
                AssistedPunchService.refusal(AssistedPunchService.Scope.ANY, hr, COMPANY, elsewhere, Set.of()).getErrorCode());
        // A login with no employee record (no company) is kept to the workspace by row-level security.
        assertNull(AssistedPunchService.refusal(AssistedPunchService.Scope.ANY, hr, null, elsewhere, Set.of()));
    }

    @Test void nobodyPunchesForThemselfWhateverTheirScope() {
        Employee me = person("Mala", EmploymentStatus.ACTIVE);
        for (AssistedPunchService.Scope scope : List.of(AssistedPunchService.Scope.ANY, AssistedPunchService.Scope.TEAM)) {
            HrmsException refused = AssistedPunchService.refusal(scope, me.getId(), COMPANY, me, Set.of(me.getId()));
            assertNotNull(refused, scope.name());
            assertEquals("ASSISTED_PUNCH_SELF", refused.getErrorCode());
        }
    }

    @Test void withoutEitherPermissionNothingIsAllowed() {
        Employee report = person("Ravi", EmploymentStatus.ACTIVE);
        HrmsException refused = AssistedPunchService.refusal(AssistedPunchService.Scope.NONE, UUID.randomUUID(), COMPANY, report, Set.of(report.getId()));
        assertEquals(HttpStatus.FORBIDDEN, refused.getStatus());
        assertEquals("ASSISTED_PUNCH_NOT_ALLOWED", refused.getErrorCode());
    }

    @Test void onlyPeopleStillWorkingCanBePunched() {
        for (EmploymentStatus s : List.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED,
                EmploymentStatus.RETIRED, EmploymentStatus.SUSPENDED)) {
            Employee gone = person("Old", s);
            HrmsException refused = AssistedPunchService.refusal(AssistedPunchService.Scope.ANY, UUID.randomUUID(), COMPANY, gone, Set.of());
            assertNotNull(refused, s.name());
            assertEquals("ASSISTED_PUNCH_NOT_ACTIVE", refused.getErrorCode());
        }
        for (EmploymentStatus s : List.of(EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION, EmploymentStatus.NOTICE_PERIOD, EmploymentStatus.ON_LEAVE)) {
            assertTrue(AssistedPunchService.isWorking(person("Now", s)), s.name());
        }
    }

    // ── the self punch's zone rule ───────────────────────────────────────────

    @Test void outsideTheZoneBlocksOnlyWhenTheServerAndTheCompanyEnforceItAndItIsNotAWfhDay() {
        assertTrue(AssistedPunchService.zoneBlocks(false, true, true, false));
        assertFalse(AssistedPunchService.zoneBlocks(true, true, true, false));
        assertFalse(AssistedPunchService.zoneBlocks(false, false, true, false));
        assertFalse(AssistedPunchService.zoneBlocks(false, true, false, false));
        assertFalse(AssistedPunchService.zoneBlocks(false, true, true, true));
    }

    // ── face results, reworded for the person holding the phone ─────────────

    @Test void faceRefusalsKeepTheirStatusAndNameThePerson() {
        HrmsException mismatch = AssistedPunchService.faceRefusal(
                new ResponseStatusException(HttpStatus.FORBIDDEN, "FAIL_MATCH:That doesn't look like your enrolled face."), "Ravi Kumar");
        assertEquals(HttpStatus.FORBIDDEN, mismatch.getStatus());
        assertEquals("FAIL_MATCH", mismatch.getErrorCode());
        assertTrue(mismatch.getMessage().contains("Ravi Kumar"));
        HrmsException notEnrolled = AssistedPunchService.faceRefusal(
                new ResponseStatusException(HttpStatus.CONFLICT, "FACE_NOT_ENROLLED:You haven't enrolled your face yet."), "Ravi Kumar");
        assertEquals(HttpStatus.CONFLICT, notEnrolled.getStatus());
        assertEquals("FACE_NOT_ENROLLED", notEnrolled.getErrorCode());
        HrmsException down = AssistedPunchService.faceRefusal(
                new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "FACE_WORKER_UNAVAILABLE:Face check service is temporarily unavailable."), "Ravi Kumar");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, down.getStatus());
        assertEquals("Face check service is temporarily unavailable.", down.getMessage());
    }

    @Test void faceEnrolmentStatusFollowsTheFaceModule() {
        assertEquals("ENROLLED", AssistedPunchService.faceStatus("ACTIVE", 3));
        assertEquals("ENROLLED", AssistedPunchService.faceStatus("PENDING", 3)); // FaceService self-heals it
        assertEquals("NOT_ENROLLED", AssistedPunchService.faceStatus("PENDING", 2));
        assertEquals("LOCKED", AssistedPunchService.faceStatus("LOCKED", 3));
        assertEquals("NOT_ENROLLED", AssistedPunchService.faceStatus("REVOKED", 0));
        assertEquals("NOT_ENROLLED", AssistedPunchService.faceStatus(null, 0));
    }

    @Test void punchTypes() {
        assertEquals(AssistedPunchService.PunchType.CHECK_IN, AssistedPunchService.PunchType.parse("check_in"));
        assertEquals(AssistedPunchService.PunchType.CHECK_OUT, AssistedPunchService.PunchType.parse("OUT"));
        assertEquals("PUNCH_IN", AssistedPunchService.PunchType.CHECK_IN.facePurpose);
        assertEquals("PUNCH_OUT", AssistedPunchService.PunchType.CHECK_OUT.facePurpose);
        assertThrows(HrmsException.class, () -> AssistedPunchService.PunchType.parse("LUNCH"));
    }

    // ── the My team rule, whatever the manager's permissions ─────────────────

    @Test void theTeamIsTheDepartmentsTheyHeadElseTheirDirectReportsNeverThemself() {
        EmployeeRepository repo = mock(EmployeeRepository.class);
        WorkforceDepartmentRepository depts = mock(WorkforceDepartmentRepository.class);
        TeamEmployeeScope scope = new TeamEmployeeScope(repo, depts);
        Employee head = person("Head", EmploymentStatus.ACTIVE);
        UUID sales = UUID.randomUUID();
        Department dept = new Department();
        dept.setId(sales);
        Employee inDept = person("Ravi", EmploymentStatus.ACTIVE);
        inDept.setDepartmentId(sales);
        head.setDepartmentId(sales);
        Employee otherDept = person("Sita", EmploymentStatus.ACTIVE);
        otherDept.setDepartmentId(UUID.randomUUID());
        when(depts.findByDepartmentHeadEmployeeId(head.getId())).thenReturn(List.of(dept));
        when(repo.findActiveByCompany(COMPANY)).thenReturn(List.of(head, inDept, otherDept));
        assertEquals(List.of(inDept), scope.teamOf(head));

        Employee manager = person("Mgr", EmploymentStatus.ACTIVE);
        Employee report = person("Asha", EmploymentStatus.ACTIVE);
        when(depts.findByDepartmentHeadEmployeeId(manager.getId())).thenReturn(List.of());
        when(repo.findByManagerId(manager.getId())).thenReturn(List.of(report, manager));
        assertEquals(List.of(report), scope.teamOf(manager));

        // The dashboard's resolve() for a manager is the same team as before.
        when(repo.findById(manager.getId())).thenReturn(Optional.of(manager));
        assertEquals(List.of(report), scope.resolve(token(manager.getId(), "attendance.team.read"), null));
    }

    // ── the order of the server's checks ─────────────────────────────────────

    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final TeamEmployeeScope teamScope = mock(TeamEmployeeScope.class);
    private final AttendanceService attendance = mock(AttendanceService.class);
    private final AttendanceContextResolver contexts = mock(AttendanceContextResolver.class);
    private final GeoValidationService geo = mock(GeoValidationService.class);
    private final FaceService face = mock(FaceService.class);
    private final AssistedPunchRecorder recorder = mock(AssistedPunchRecorder.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    private AssistedPunchService service() {
        AssistedPunchService s = new AssistedPunchService(employees, mock(WorkforceDepartmentRepository.class), teamScope,
                attendance, contexts, geo, face, recorder, jdbc);
        ReflectionTestUtils.setField(s, "geofenceEnforce", true);
        return s;
    }

    private AssistedPunchService.PunchRequest request(UUID employeeId) {
        return new AssistedPunchService.PunchRequest(employeeId, "CHECK_IN", "QUJD", FaceDtos.Challenge.BLINK, 17.36, 78.53, 12.0, "Pixel 7");
    }

    private void enrolled(UUID employeeId, UUID login) {
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(TENANT), eq(employeeId))).thenReturn(List.of(login));
        when(face.getStatus(TENANT, login)).thenReturn(new FaceDtos.EnrollmentStatusResponse(
                FaceDtos.EnrollmentStatus.ACTIVE, 3, 3, List.of(), 0, false, null));
        when(attendance.getTodayRecord(employeeId)).thenReturn(Optional.empty());
        when(contexts.resolve(employeeId)).thenReturn(new AttendanceContextResolver.Context(
                employeeId, COMPANY, UUID.randomUUID(), null, 17.36, 78.53, 100, "Head office"));
    }

    @Test void aManagerOutsideTheirTeamIsRefusedBeforeAnythingElseRuns() {
        Employee manager = person("Mgr", EmploymentStatus.ACTIVE);
        Employee outsider = person("Sita", EmploymentStatus.ACTIVE);
        when(employees.findById(manager.getId())).thenReturn(Optional.of(manager));
        when(employees.findById(outsider.getId())).thenReturn(Optional.of(outsider));
        when(teamScope.teamOf(manager)).thenReturn(List.of());
        HrmsException e = assertThrows(HrmsException.class,
                () -> service().punch(token(manager.getId(), AssistedPunchService.PERM_TEAM), request(outsider.getId())));
        assertEquals("ASSISTED_PUNCH_NOT_IN_TEAM", e.getErrorCode());
        verifyNoInteractions(face, geo, recorder);
    }

    @Test void outsideTheWorkAreaIsRefusedBeforeTheFaceIsChecked() {
        Employee manager = person("Mgr", EmploymentStatus.ACTIVE);
        Employee report = person("Ravi", EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        when(employees.findById(manager.getId())).thenReturn(Optional.of(manager));
        when(employees.findById(report.getId())).thenReturn(Optional.of(report));
        when(teamScope.teamOf(manager)).thenReturn(List.of(report));
        enrolled(report.getId(), login);
        when(geo.validate(any(), any(), any(), any(), anyInt())).thenReturn(new GeoValidateResponse(false, null, null, 900.0, "far"));
        HrmsException e = assertThrows(HrmsException.class,
                () -> service().punch(token(manager.getId(), AssistedPunchService.PERM_TEAM), request(report.getId())));
        assertEquals("OUTSIDE_GEOFENCE", e.getErrorCode());
        verify(face, never()).verify(any(), any(), any(), any());
        verifyNoInteractions(recorder);
    }

    @Test void aFaceThatDoesNotMatchTheEmployeeNeverPunches() {
        Employee hr = person("Hema", EmploymentStatus.ACTIVE);
        Employee anyone = person("Ravi", EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        when(employees.findById(hr.getId())).thenReturn(Optional.of(hr));
        when(employees.findById(anyone.getId())).thenReturn(Optional.of(anyone));
        enrolled(anyone.getId(), login);
        when(geo.validate(any(), any(), any(), any(), anyInt())).thenReturn(new GeoValidateResponse(true, null, null, 10.0, "ok"));
        when(face.verify(eq(TENANT), eq(login), any(), eq("PUNCH_IN")))
                .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "FAIL_MATCH:That doesn't look like your enrolled face."));
        HrmsException e = assertThrows(HrmsException.class,
                () -> service().punch(token(hr.getId(), AssistedPunchService.PERM_ANY), request(anyone.getId())));
        assertEquals("FAIL_MATCH", e.getErrorCode());
        // The face is checked against the EMPLOYEE's login, not the caller's.
        verify(face).verify(eq(TENANT), eq(login), any(), eq("PUNCH_IN"));
        verifyNoInteractions(recorder);
    }

    @Test void aMatchingFaceInsideTheAreaPunchesTheEmployeeAndRecordsWhoDidIt() {
        Employee manager = person("Mgr", EmploymentStatus.ACTIVE);
        Employee report = person("Ravi", EmploymentStatus.ACTIVE);
        UUID login = UUID.randomUUID();
        when(employees.findById(manager.getId())).thenReturn(Optional.of(manager));
        when(employees.findById(report.getId())).thenReturn(Optional.of(report));
        when(teamScope.teamOf(manager)).thenReturn(List.of(report));
        enrolled(report.getId(), login);
        when(geo.validate(any(), any(), any(), any(), anyInt())).thenReturn(new GeoValidateResponse(true, null, null, 10.0, "ok"));
        AttendanceDto dto = new AttendanceDto(UUID.randomUUID(), "2026-09-26", "2026-09-26T03:44:00Z", null, "OFFICE", "ON_TIME",
                "FACE_RECOGNITION", null, null, null, "Head office", null, null, 0, null, false);
        when(recorder.checkIn(eq(TENANT), any(), eq("QUJD"), eq(false), any())).thenReturn(dto);
        AssistedPunchService.PunchResponse out = service().punch(token(manager.getId(), AssistedPunchService.PERM_TEAM), request(report.getId()));
        assertEquals("Ravi Kumar", out.employeeName());
        assertEquals("Mgr Kumar", out.punchedByName());
        assertEquals("CHECK_IN", out.type());
        verify(recorder).checkIn(eq(TENANT), argThat(t -> t.employeeId().equals(report.getId())), eq("QUJD"), eq(false),
                argThat(by -> manager.getId().equals(by.employeeId()) && "Mgr Kumar".equals(by.name())));
    }

    @Test void anEmployeeWithoutAFaceEnrolmentIsRefusedBeforeTheLocationIsChecked() {
        Employee hr = person("Hema", EmploymentStatus.ACTIVE);
        Employee anyone = person("Ravi", EmploymentStatus.ACTIVE);
        when(employees.findById(hr.getId())).thenReturn(Optional.of(hr));
        when(employees.findById(anyone.getId())).thenReturn(Optional.of(anyone));
        UUID login = UUID.randomUUID();
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(UUID.class), eq(TENANT), eq(anyone.getId()))).thenReturn(List.of(login));
        when(face.getStatus(TENANT, login)).thenReturn(new FaceDtos.EnrollmentStatusResponse(
                FaceDtos.EnrollmentStatus.PENDING, 3, 0, List.of(), 0, false, null));
        HrmsException e = assertThrows(HrmsException.class,
                () -> service().punch(token(hr.getId(), AssistedPunchService.PERM_ANY), request(anyone.getId())));
        assertEquals("FACE_NOT_ENROLLED", e.getErrorCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verifyNoInteractions(geo, recorder);
    }
}
