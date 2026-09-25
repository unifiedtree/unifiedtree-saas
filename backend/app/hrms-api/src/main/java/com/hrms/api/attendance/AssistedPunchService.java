package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.GeoValidateRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Assisted face punch (V143.40): a manager or HR punches an employee in or out
 * on the manager's phone, with the employee's face.
 *
 * <p>Who: {@code attendance.assisted_punch.team} punches for the caller's team
 * (the My team rule, {@link TeamEmployeeScope#teamOf}: the departments they
 * head, else their direct reports); {@code attendance.assisted_punch.any} for
 * anyone working in the caller's company. Nobody punches for themself here.
 *
 * <p>The checks a self face punch makes, reused rather than copied: the face
 * must match the EMPLOYEE's enrolment ({@link FaceService#verify}, with its
 * lockout and audit rows), the phone must be inside the employee's work area
 * by the self punch's rule (the employee's branch or assigned zone, the
 * server-wide switch plus the company's "Require geofencing on mobile", an
 * approved work-from-home day), and the punch itself goes through
 * {@link AttendanceService#checkInJson} / {@link AttendanceService#checkOut}
 * (one punch in a day, idempotent client event ids). The punch is then
 * recorded as "punched by" the caller (attendance.assisted_punches) and in the
 * audit log.
 */
@Service
public class AssistedPunchService {

    private static final Logger log = LoggerFactory.getLogger(AssistedPunchService.class);

    static final String PERM_TEAM = "attendance.assisted_punch.team";
    static final String PERM_ANY = "attendance.assisted_punch.any";
    static final int LIST_LIMIT = 200;
    /** FaceService captures three angles; a PENDING enrolment with all of them counts as enrolled (its self-heal rule). */
    static final int FACE_SAMPLES = 3;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final java.util.regex.Pattern BASE64 = java.util.regex.Pattern.compile("^[A-Za-z0-9+/=]+$");
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(IST);
    /** Statuses of someone still working here and expected to punch. */
    private static final Set<EmploymentStatus> WORKING = Set.of(
            EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION, EmploymentStatus.NOTICE_PERIOD, EmploymentStatus.ON_LEAVE);

    enum Scope { ANY, TEAM, NONE }

    enum PunchType {
        CHECK_IN("PUNCH_IN"), CHECK_OUT("PUNCH_OUT");
        final String facePurpose;
        PunchType(String facePurpose) { this.facePurpose = facePurpose; }

        static PunchType parse(String raw) {
            String s = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
            return switch (s) {
                case "CHECK_IN", "IN", "PUNCH_IN" -> CHECK_IN;
                case "CHECK_OUT", "OUT", "PUNCH_OUT" -> CHECK_OUT;
                default -> throw new BusinessRuleException("Choose punch in or punch out.", "ASSISTED_PUNCH_TYPE_INVALID");
            };
        }
    }

    /** POST body. The face fields are the self face punch's ({@code POST /v1/attendance/checkin/face}). */
    public record PunchRequest(
            UUID employeeId,
            String type,
            String imageBase64,
            FaceDtos.Challenge challengePerformed,
            Double latitude,
            Double longitude,
            Double accuracy,
            String deviceId) {}

    public record PunchResponse(
            UUID employeeId, String employeeName, String type, String punchedAt, String attendanceStatus,
            String locationName, String punchedByName, AttendanceDto attendance) {}

    /** One person the caller may punch for. faceStatus: ENROLLED · NOT_ENROLLED · LOCKED · NO_LOGIN. */
    public record EligibleEmployee(
            UUID employeeId, String employeeCode, String fullName, String jobTitle, String departmentName,
            String profilePhotoUrl, String faceStatus, String todayStatus, String checkInTime, String checkOutTime) {}

    /** scope: TEAM or ANY. truncated: more people matched than were returned (search to narrow). */
    public record EligibleList(String scope, List<EligibleEmployee> employees, boolean truncated) {}

    private final EmployeeRepository employees;
    private final WorkforceDepartmentRepository departments;
    private final TeamEmployeeScope teamScope;
    private final AttendanceService attendanceService;
    private final AttendanceContextResolver contextResolver;
    private final GeoValidationService geoValidationService;
    private final FaceService faceService;
    private final AssistedPunchRecorder recorder;
    private final JdbcTemplate jdbc;

    @Autowired(required = false)
    private com.unifiedtree.settings.service.HrConfigurationService hrConfiguration;
    @Autowired(required = false)
    private AttendanceReviewService reviewService;
    @Autowired(required = false)
    private AuditService audit;

    /** The self punch's server-wide switch (AttendanceController, hrms.attendance.geofence-enforce). */
    @Value("${hrms.attendance.geofence-enforce:false}")
    private boolean geofenceEnforce;

    public AssistedPunchService(EmployeeRepository employees, WorkforceDepartmentRepository departments,
                                TeamEmployeeScope teamScope, AttendanceService attendanceService,
                                AttendanceContextResolver contextResolver, GeoValidationService geoValidationService,
                                FaceService faceService, AssistedPunchRecorder recorder, JdbcTemplate jdbc) {
        this.employees = employees;
        this.departments = departments;
        this.teamScope = teamScope;
        this.attendanceService = attendanceService;
        this.contextResolver = contextResolver;
        this.geoValidationService = geoValidationService;
        this.faceService = faceService;
        this.recorder = recorder;
        this.jdbc = jdbc;
    }

    // ── decisions (package-visible for tests) ────────────────────────────────

    /** "Anyone" wins over "their team"; neither means no assisted punching. */
    static Scope scopeOf(Jwt jwt) {
        if (AttendanceController.hasPermission(jwt, PERM_ANY)) return Scope.ANY;
        if (AttendanceController.hasPermission(jwt, PERM_TEAM)) return Scope.TEAM;
        return Scope.NONE;
    }

    static boolean isWorking(Employee e) {
        return e != null && e.getEmploymentStatus() != null && WORKING.contains(e.getEmploymentStatus());
    }

    /**
     * Why the caller may NOT punch for {@code target}, or null when they may.
     *
     * @param callerCompanyId the caller's company, null when the login has no employee record
     * @param team            the caller's team (My team rule), used for {@link Scope#TEAM}
     */
    static HrmsException refusal(Scope scope, UUID callerEmployeeId, UUID callerCompanyId, Employee target, Set<UUID> team) {
        if (scope == Scope.NONE)
            return new HrmsException("You don't have permission to punch for other people.", HttpStatus.FORBIDDEN, "ASSISTED_PUNCH_NOT_ALLOWED");
        if (target.getId().equals(callerEmployeeId))
            return new BusinessRuleException("You can't punch for yourself here. Use your own Punch in.", "ASSISTED_PUNCH_SELF");
        if (scope == Scope.TEAM && !team.contains(target.getId()))
            return new HrmsException(name(target) + " isn't in your team, so you can't punch for them.", HttpStatus.FORBIDDEN, "ASSISTED_PUNCH_NOT_IN_TEAM");
        if (scope == Scope.ANY && callerCompanyId != null && !callerCompanyId.equals(target.getCompanyId()))
            return new HrmsException(name(target) + " works in another company, so you can't punch for them.", HttpStatus.FORBIDDEN, "ASSISTED_PUNCH_OTHER_COMPANY");
        if (!isWorking(target))
            return new BusinessRuleException(name(target) + " isn't an active employee, so they can't be punched in or out.", "ASSISTED_PUNCH_NOT_ACTIVE");
        return null;
    }

    /**
     * The self punch's zone rule (AttendanceController.checkIn): outside the zone
     * blocks the punch only when the server-wide switch AND the company's
     * "Require geofencing on mobile" are on and it isn't an approved
     * work-from-home day.
     */
    static boolean zoneBlocks(boolean withinFence, boolean serverEnforces, boolean companyRequires, boolean wfhDay) {
        return !withinFence && serverEnforces && companyRequires && !wfhDay;
    }

    /**
     * The face module's refusal ("CODE:sentence", written for the person on the
     * camera) reworded for the one holding the phone. Same HTTP status, the code
     * as the error code.
     */
    static HrmsException faceRefusal(ResponseStatusException ex, String name) {
        String reason = ex.getReason() == null ? "" : ex.getReason();
        int colon = reason.indexOf(':');
        String code = colon > 0 ? reason.substring(0, colon) : "FACE_CHECK_FAILED";
        String original = colon > 0 ? reason.substring(colon + 1).trim() : reason.trim();
        String first = firstName(name);
        String message = switch (code) {
            case "FACE_NOT_ENROLLED" -> name + " hasn't enrolled their face yet. They need to do face enrolment once in the app first.";
            case "FACE_TEMPLATE_INCOMPLETE" -> name + "'s face enrolment isn't complete. Ask HR to reset it so they can enrol again.";
            case "FACE_LOCKED" -> name + "'s face check is locked after several failed tries. It unlocks by itself after a while, or HR can reset it.";
            case "FAIL_MATCH", "FAIL_MATCH_INCONSISTENT" -> "The face didn't match " + name + "'s enrolled face. Check it's " + first + " in front of the camera, in even light, and try again.";
            case "FAIL_LIVENESS" -> "We couldn't confirm a live face. Ask " + first + " to blink while looking at the camera, then try again.";
            case "FAIL_NO_FACE" -> "We can't see a face in the photo. Point the camera at " + first + "'s face and try again.";
            case "FAIL_MULTIPLE_FACES" -> "More than one face is in the photo. Make sure only " + first + " is in the frame.";
            case "FAIL_LOW_QUALITY" -> "The photo wasn't sharp enough. Hold the phone steady, in even light, and try again.";
            default -> original.isEmpty() ? "The face check couldn't complete. Please try again." : original;
        };
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        return new HrmsException(message, status != null ? status : HttpStatus.FORBIDDEN, code);
    }

    // ── GET /eligible ────────────────────────────────────────────────────────

    public EligibleList eligible(Jwt jwt, String q) {
        Scope scope = scopeOf(jwt);
        if (scope == Scope.NONE)
            throw new HrmsException("You don't have permission to punch for other people.", HttpStatus.FORBIDDEN, "ASSISTED_PUNCH_NOT_ALLOWED");
        UUID callerId = AttendanceReviewService.callerEmployeeId(jwt);
        Employee caller = employees.findById(callerId).orElse(null);
        List<Employee> pool;
        if (scope == Scope.TEAM) {
            pool = caller == null ? List.of() : teamScope.teamOf(caller);
        } else {
            // Everyone working in the caller's company (the company-wide attendance scope).
            // A login without an employee record sees the workspace (row-level security keeps it to the tenant).
            pool = caller != null ? employees.findActiveByCompany(caller.getCompanyId()) : employees.findAll();
        }
        String query = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        List<Employee> matches = pool.stream()
                .filter(AssistedPunchService::isWorking)
                .filter(e -> !e.getId().equals(callerId))
                .filter(e -> query.isEmpty() || matchesSearch(e, query))
                .sorted(Comparator.comparing(e -> Objects.toString(name(e), "").toLowerCase(Locale.ROOT)))
                .toList();
        boolean truncated = matches.size() > LIST_LIMIT;
        List<Employee> page = truncated ? matches.subList(0, LIST_LIMIT) : matches;
        List<UUID> ids = page.stream().map(Employee::getId).toList();
        UUID tenantId = tenantOf(jwt);
        Map<UUID, String> faces = faceStatuses(tenantId, ids);
        Map<UUID, AttendanceRecord> today = new HashMap<>();
        attendanceService.getRecordsForEmployeesOnDate(ids, LocalDate.now(IST))
                .forEach(r -> today.putIfAbsent(r.getEmployeeId(), r));
        Map<UUID, String> deptNames = departmentNames(page);
        List<EligibleEmployee> out = new ArrayList<>(page.size());
        for (Employee e : page) {
            AttendanceRecord r = today.get(e.getId());
            String state = r == null || r.getCheckInAt() == null ? "NOT_PUNCHED" : r.getCheckOutAt() == null ? "PUNCHED_IN" : "PUNCHED_OUT";
            out.add(new EligibleEmployee(e.getId(), e.getEmployeeCode(), name(e), e.getJobTitle(),
                    e.getDepartmentId() != null ? deptNames.get(e.getDepartmentId()) : null, e.getProfilePhotoUrl(),
                    faces.getOrDefault(e.getId(), "NO_LOGIN"), state,
                    r != null && r.getCheckInAt() != null ? r.getCheckInAt().toString() : null,
                    r != null && r.getCheckOutAt() != null ? r.getCheckOutAt().toString() : null));
        }
        return new EligibleList(scope.name(), out, truncated);
    }

    private static boolean matchesSearch(Employee e, String query) {
        return Objects.toString(name(e), "").toLowerCase(Locale.ROOT).contains(query)
                || Objects.toString(e.getEmployeeCode(), "").toLowerCase(Locale.ROOT).contains(query);
    }

    /** Face enrolment per employee (through their app login): the best of their logins. */
    private Map<UUID, String> faceStatuses(UUID tenantId, List<UUID> employeeIds) {
        Map<UUID, String> out = new HashMap<>();
        if (employeeIds.isEmpty()) return out;
        String in = String.join(",", Collections.nCopies(employeeIds.size(), "?"));
        List<Object> params = new ArrayList<>();
        params.add(tenantId);
        params.addAll(employeeIds);
        jdbc.query("""
                SELECT uc.employee_id, fe.status, fe.samples_captured
                  FROM auth.user_credentials uc
                  LEFT JOIN attendance.face_enrollments fe ON fe.tenant_id = uc.tenant_id AND fe.employee_id = uc.id
                 WHERE uc.tenant_id = ? AND uc.employee_id IN (%s)
                """.formatted(in), (RowCallbackHandler) rs -> {
                    UUID emp = (UUID) rs.getObject("employee_id");
                    String status = faceStatus(rs.getString("status"), rs.getInt("samples_captured"));
                    out.merge(emp, status, (a, b) -> rank(a) <= rank(b) ? a : b);
                }, params.toArray());
        return out;
    }

    static String faceStatus(String enrollmentStatus, int samplesCaptured) {
        if ("ACTIVE".equals(enrollmentStatus)) return "ENROLLED";
        if ("PENDING".equals(enrollmentStatus) && samplesCaptured >= FACE_SAMPLES) return "ENROLLED";
        if ("LOCKED".equals(enrollmentStatus)) return "LOCKED";
        return "NOT_ENROLLED";
    }

    private static int rank(String faceStatus) {
        return switch (faceStatus) { case "ENROLLED" -> 0; case "LOCKED" -> 1; case "NOT_ENROLLED" -> 2; default -> 3; };
    }

    // ── POST ─────────────────────────────────────────────────────────────────

    public PunchResponse punch(Jwt jwt, PunchRequest req) {
        if (req == null || req.employeeId() == null)
            throw new BusinessRuleException("Choose the person to punch for.", "EMPLOYEE_REQUIRED");
        PunchType type = PunchType.parse(req.type());
        if (req.imageBase64() == null || req.imageBase64().isBlank())
            throw new BusinessRuleException("Scan the person's face first.", "FACE_IMAGE_REQUIRED");
        // The self face check's rule for the image (FaceDtos.VerifyRequest): plain base64.
        if (!BASE64.matcher(req.imageBase64()).matches())
            throw new BusinessRuleException("The face photo couldn't be read. Take it again.", "FACE_IMAGE_INVALID");
        if (req.latitude() == null || req.longitude() == null
                || Math.abs(req.latitude()) > 90 || Math.abs(req.longitude()) > 180)
            throw new BusinessRuleException("Your phone's location is needed to punch. Turn on location and try again.", "LOCATION_REQUIRED");

        UUID tenantId = tenantOf(jwt);
        Scope scope = scopeOf(jwt);
        UUID callerId = AttendanceReviewService.callerEmployeeId(jwt);
        Employee caller = employees.findById(callerId).orElse(null);
        Employee target = employees.findById(req.employeeId())
                .orElseThrow(() -> new ResourceNotFoundException("That employee wasn't found."));
        Set<UUID> team = scope == Scope.TEAM && caller != null
                ? teamScope.teamOf(caller).stream().map(Employee::getId).collect(Collectors.toSet())
                : Set.of();
        HrmsException refused = refusal(scope, callerId, caller != null ? caller.getCompanyId() : null, target, team);
        if (refused != null) throw refused;
        String name = name(target);

        // Enrolled? (before the location and the camera, so nobody scans a face for nothing)
        UUID targetLogin = faceLoginOf(tenantId, target.getId());
        if (targetLogin == null)
            throw new HrmsException(name + " has no app login, so there is no face enrolment to check against.", HttpStatus.CONFLICT, "FACE_NOT_ENROLLED");
        FaceDtos.EnrollmentStatus enrolment = faceService.getStatus(tenantId, targetLogin).status();
        if (enrolment != FaceDtos.EnrollmentStatus.ACTIVE && enrolment != FaceDtos.EnrollmentStatus.LOCKED)
            throw new HrmsException(name + " hasn't enrolled their face yet. They need to do face enrolment once in the app first.", HttpStatus.CONFLICT, "FACE_NOT_ENROLLED");

        // Already punched? (one punch in and one punch out a day, as for a self punch)
        AttendanceDto todayRecord = attendanceService.getTodayRecord(target.getId()).orElse(null);
        if (type == PunchType.CHECK_IN && todayRecord != null && todayRecord.checkInTime() != null)
            throw new HrmsException(name + " already punched in today at " + clock(todayRecord.checkInTime()) + ".", HttpStatus.CONFLICT, "ALREADY_CHECKED_IN");
        if (type == PunchType.CHECK_OUT && todayRecord != null && todayRecord.checkOutTime() != null)
            throw new HrmsException(name + " already punched out today at " + clock(todayRecord.checkOutTime()) + ".", HttpStatus.CONFLICT, "ALREADY_CHECKED_OUT");
        if (type == PunchType.CHECK_OUT && (todayRecord == null || todayRecord.checkInTime() == null) && !openSinceYesterday(target.getId()))
            throw new HrmsException(name + " hasn't punched in today, so there is nothing to punch out.", HttpStatus.CONFLICT, "NOT_CHECKED_IN");

        // The phone must be inside the employee's work area, by the self punch's rule.
        double lat = req.latitude(), lon = req.longitude();
        AttendanceContextResolver.Context ctx = contextResolver.resolve(target.getId());
        GeoValidateResponse geo = geoValidationService.validate(new GeoValidateRequest(target.getId(), lat, lon),
                ctx.branchId(), ctx.branchLat(), ctx.branchLon(), ctx.geoFenceRadius());
        boolean wfhDay = attendanceService.isApprovedWfhDay(target.getId(), LocalDate.now(IST));
        if (zoneBlocks(geo.withinFence(), geofenceEnforce, companyRequiresGeofence(ctx.companyId()), wfhDay)) {
            String place = ctx.branchName() != null ? ctx.branchName() : "their office";
            String away = geo.distanceMeters() != null ? ", about " + Math.round(geo.distanceMeters()) + " m away" : "";
            throw new BusinessRuleException("You're outside " + firstName(name) + "'s work area (" + place + away
                    + "). Punch from inside it.", "OUTSIDE_GEOFENCE");
        }

        // The face must match THIS employee's enrolment.
        String device = FacePunchDevices.label(req.deviceId());
        try {
            faceService.verify(tenantId, targetLogin,
                    new FaceDtos.VerifyRequest(req.imageBase64(), req.challengePerformed(), lat, lon, device),
                    type.facePurpose);
        } catch (ResponseStatusException ex) {
            throw faceRefusal(ex, name);
        }

        // The punch, on the employee's attendance, with who made it.
        Reviewer who = who(jwt, caller);
        AssistedPunchRecorder.PunchedBy by = new AssistedPunchRecorder.PunchedBy(who.userId(), who.employeeId(), who.name(),
                lat, lon, req.accuracy(), geo.distanceMeters() != null ? (int) Math.round(geo.distanceMeters()) : null,
                geo.withinFence(), device, recorder.latestPassedFaceEvent(tenantId, targetLogin, type.facePurpose));
        AssistedPunchRecorder.Target t = new AssistedPunchRecorder.Target(target.getId(), ctx.companyId(), ctx.branchId(),
                ctx.departmentId(), ctx.branchName());
        AttendanceDto dto;
        try {
            dto = type == PunchType.CHECK_IN
                    ? recorder.checkIn(tenantId, t, req.imageBase64(), wfhDay, by)
                    : recorder.checkOut(tenantId, t, by);
        } catch (ResourceNotFoundException noOpenDay) {
            throw new HrmsException(name + " hasn't punched in today, so there is nothing to punch out.", HttpStatus.CONFLICT, "NOT_CHECKED_IN");
        }

        // Same follow-up as a self check-in accepted outside the zone: it goes on the review list.
        if (type == PunchType.CHECK_IN && !geo.withinFence() && !wfhDay && reviewService != null && dto.id() != null) {
            try {
                reviewService.flagOutsideGeofence(dto.id(), LocalDate.parse(dto.attendanceDate()), geo.distanceMeters());
            } catch (RuntimeException e) {
                log.warn("Could not flag an outside-zone assisted check-in {}: {}", dto.id(), e.getMessage());
            }
        }
        String at = type == PunchType.CHECK_IN ? dto.checkInTime() : dto.checkOutTime();
        audit(type, target.getId(), "%s punched %s %s at %s with a face scan on their phone%s.".formatted(
                who.name(), name, type == PunchType.CHECK_IN ? "in" : "out", clock(at),
                by.distanceMeters() != null && ctx.branchName() != null
                        ? " (" + by.distanceMeters() + " m from " + ctx.branchName() + ")" : ""));
        return new PunchResponse(target.getId(), name, type.name(), at, dto.attendanceStatus(), dto.locationName(), who.name(), dto);
    }

    /** An overnight shift still open from yesterday, which a punch out today closes (as AttendanceService.checkOut does). */
    private boolean openSinceYesterday(UUID employeeId) {
        return attendanceService.getRecordsForEmployeesOnDate(List.of(employeeId), LocalDate.now(IST).minusDays(1)).stream()
                .anyMatch(r -> r.getCheckInAt() != null && r.getCheckOutAt() == null);
    }

    /** The target's app login whose face enrolment to check: an active enrolment first. Null when they have no login. */
    private UUID faceLoginOf(UUID tenantId, UUID employeeId) {
        List<UUID> ids = jdbc.queryForList("""
                SELECT uc.id
                  FROM auth.user_credentials uc
                  LEFT JOIN attendance.face_enrollments fe ON fe.tenant_id = uc.tenant_id AND fe.employee_id = uc.id
                 WHERE uc.tenant_id = ? AND uc.employee_id = ?
                 ORDER BY CASE fe.status WHEN 'ACTIVE' THEN 0 WHEN 'LOCKED' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
                          uc.is_active DESC, uc.created_at
                 LIMIT 1
                """, UUID.class, tenantId, employeeId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /** The company's "Require geofencing on mobile" rule; true (enforce) when it can't be read, as for a self punch. */
    private boolean companyRequiresGeofence(UUID companyId) {
        if (hrConfiguration == null || companyId == null) return true;
        try {
            return hrConfiguration.getOrDefault(companyId).enforceGeofencingForMobile();
        } catch (RuntimeException e) {
            return true;
        }
    }

    private record Reviewer(UUID userId, UUID employeeId, String name) {}

    private static Reviewer who(Jwt jwt, Employee caller) {
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        String name = caller != null ? name(caller) : null;
        if (name == null || name.isBlank()) name = jwt.getClaimAsString("email");
        return new Reviewer(userId, caller != null ? caller.getId() : null, name);
    }

    private void audit(PunchType type, UUID employeeId, String summary) {
        if (audit == null) return;
        try {
            audit.record("attendance", type == PunchType.CHECK_IN ? "ASSISTED_PUNCH_IN" : "ASSISTED_PUNCH_OUT",
                    "employee", employeeId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for an assisted punch: {}", e.getMessage());
        }
    }

    private Map<UUID, String> departmentNames(List<Employee> list) {
        List<UUID> ids = list.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        Map<UUID, String> names = new HashMap<>();
        if (!ids.isEmpty()) departments.findAllById(ids).forEach(d -> names.put(d.getId(), d.getName()));
        return names;
    }

    private static UUID tenantOf(Jwt jwt) {
        Object claim = jwt.getClaim("tenant_id");
        if (claim == null) throw new IllegalStateException("JWT missing tenant_id");
        return UUID.fromString(claim.toString());
    }

    static String name(Employee e) {
        String n = AttendanceReviewService.name(e);
        return n == null || n.isBlank() ? (e != null && e.getEmployeeCode() != null ? e.getEmployeeCode() : "This person") : n;
    }

    static String firstName(String name) {
        if (name == null || name.isBlank()) return "them";
        int space = name.indexOf(' ');
        return space > 0 ? name.substring(0, space) : name;
    }

    private static String clock(String iso) {
        try {
            return CLOCK.format(Instant.parse(iso));
        } catch (RuntimeException e) {
            return iso;
        }
    }

}
