package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.GeoValidateRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.auth.service.JwtService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Face station (V143.95, spec 14.4): a shared device at one branch, signed in as
 * a station, where anyone working at that branch punches in or out with their
 * face. Design: docs/redesign/FACE_STATION.md.
 *
 * <p><b>Setting up</b> (admin/HR: attendance.policy.manage and
 * attendance.assisted_punch.any): create a station for a branch, start it on a
 * device (a station token for that device), revoke it, or delete one that never
 * punched anyone.
 *
 * <p><b>At the station</b> (a station token only): the station's name, a search
 * of its branch's people (name, code, department, face ready; nothing else), and
 * the punch. The punch makes exactly the assisted punch's checks, reused: the
 * person must work at the station's branch and be active, the face must match
 * THEIR enrolment ({@link FaceService#verify}, with its lockout), the station
 * must be inside their work area by the self punch's rule, one punch in and out
 * a day; it is written by {@link AssistedPunchRecorder} (so it is "punched by"
 * the station everywhere) together with the station's own row, in one
 * transaction. A match that wasn't certain (below HIGH) is saved as needing the
 * manager's approval: it is on the face review list ("To check") for the
 * manager and HR, where "Not them" stops it counting.
 */
@Service
public class FaceStationService {

    private static final Logger log = LoggerFactory.getLogger(FaceStationService.class);

    static final String TOKEN_TYPE = "station";
    static final String MANAGE_1 = "attendance.policy.manage";
    static final String MANAGE_2 = "attendance.assisted_punch.any";
    /** A station's sign-in lasts this long; the device renews it every day while it runs. */
    static final Duration TOKEN_TTL = Duration.ofDays(30);
    static final int NAME_MIN = 2, NAME_MAX = 80;
    static final int SEARCH_MIN = 2, SEARCH_LIMIT = 8;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final java.util.regex.Pattern BASE64 = java.util.regex.Pattern.compile("^[A-Za-z0-9+/=]+$");

    // ── wire shapes ──────────────────────────────────────────────────────────

    public record CreateRequest(String name, UUID branchId) {}

    /** What a device gets when an admin starts the station on it. */
    public record DeviceSession(String token, Instant expiresAt, StationInfo station) {}

    /** What the station screen shows about itself. */
    public record StationInfo(UUID stationId, String name, UUID branchId, String branchName) {}

    /** One person at the station's search: no photo, no attendance. */
    public record StationPerson(UUID employeeId, String fullName, String employeeCode, String departmentName, boolean faceReady) {}

    public record PeopleList(List<StationPerson> people, boolean truncated, String hint) {}

    public record PunchRequest(UUID employeeId, String type, String imageBase64, FaceDtos.Challenge challengePerformed,
                               Double latitude, Double longitude, Double accuracy, String deviceId) {}

    /** The success card: who, when, and whether the manager still has to confirm it. */
    public record PunchResult(UUID employeeId, String employeeName, String employeeCode, String departmentName,
                              String jobTitle, String type, String punchedAt, String attendanceStatus,
                              String locationName, boolean needsApproval, String stationName) {}

    private final FaceStations stations;
    private final EmployeeRepository employees;
    private final WorkforceBranchRepository branches;
    private final WorkforceDepartmentRepository departments;
    private final AssistedPunchService assisted;
    private final AssistedPunchRecorder recorder;
    private final AttendanceService attendanceService;
    private final AttendanceContextResolver contextResolver;
    private final GeoValidationService geoValidationService;
    private final FaceService faceService;
    private final JwtService jwtService;
    private final TransactionTemplate tx;

    @Autowired(required = false)
    private AttendanceReviewService reviewService;
    @Autowired(required = false)
    private AuditService audit;
    @Autowired(required = false)
    private PunchRulesService punchRules;

    @Value("${hrms.attendance.geofence-enforce:false}")
    private boolean geofenceEnforce;

    public FaceStationService(FaceStations stations, EmployeeRepository employees, WorkforceBranchRepository branches,
                              WorkforceDepartmentRepository departments, AssistedPunchService assisted,
                              AssistedPunchRecorder recorder, AttendanceService attendanceService,
                              AttendanceContextResolver contextResolver, GeoValidationService geoValidationService,
                              FaceService faceService, JwtService jwtService, PlatformTransactionManager txManager) {
        this.stations = stations;
        this.employees = employees;
        this.branches = branches;
        this.departments = departments;
        this.assisted = assisted;
        this.recorder = recorder;
        this.attendanceService = attendanceService;
        this.contextResolver = contextResolver;
        this.geoValidationService = geoValidationService;
        this.faceService = faceService;
        this.jwtService = jwtService;
        this.tx = new TransactionTemplate(txManager);
    }

    // ── decisions (package-visible for tests) ────────────────────────────────

    /** A station's sign-in, not a person's. */
    static boolean isStationToken(Jwt jwt) {
        return jwt != null && TOKEN_TYPE.equals(jwt.getClaimAsString("token_type"));
    }

    /** May set up stations: attendance settings AND punching for anyone in the company. Never a station. */
    static boolean canManage(Jwt jwt) {
        return jwt != null && !isStationToken(jwt)
                && AttendanceController.hasPermission(jwt, MANAGE_1) && AttendanceController.hasPermission(jwt, MANAGE_2);
    }

    /**
     * The person works at the station's branch: in its company, and either placed
     * at that branch or placed at none while that branch is the company's default
     * (HQ, else the first active branch): the rule the punch's work area uses
     * ({@link AttendanceContextResolver}).
     */
    static boolean worksAt(Employee e, UUID companyId, UUID branchId, UUID companyDefaultBranchId) {
        if (e == null || companyId == null || branchId == null || !companyId.equals(e.getCompanyId())) return false;
        if (e.getBranchId() != null) return branchId.equals(e.getBranchId());
        return branchId.equals(companyDefaultBranchId);
    }

    /** Anything short of a HIGH match goes to the manager to approve. */
    static boolean needsApproval(String scoreBucket) {
        return !"HIGH".equals(scoreBucket);
    }

    /** Enrolled (or locked for a while): the face check can run. No login or no enrolment: it can't. */
    static boolean faceReady(String faceStatus) {
        return "ENROLLED".equals(faceStatus) || "LOCKED".equals(faceStatus);
    }

    /** The station's name, trimmed; null when it's too short or too long. */
    static String cleanName(String raw) {
        if (raw == null) return null;
        String s = raw.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
        return s.length() < NAME_MIN || s.length() > NAME_MAX ? null : s;
    }

    /** The search text, or null when it is too short to search (a station never lists the whole branch). */
    static String searchText(String q) {
        String s = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        return s.length() < SEARCH_MIN ? null : s;
    }

    /** The face module's refusal, worded for the person standing at the station. */
    static HrmsException faceRefusal(ResponseStatusException ex, String name) {
        String reason = ex.getReason() == null ? "" : ex.getReason();
        int colon = reason.indexOf(':');
        String code = colon > 0 ? reason.substring(0, colon) : "FACE_CHECK_FAILED";
        String original = colon > 0 ? reason.substring(colon + 1).trim() : reason.trim();
        String message = switch (code) {
            case "FACE_NOT_ENROLLED" -> "You haven't enrolled your face yet. Enrol it once in the app, then punch here.";
            case "FACE_TEMPLATE_INCOMPLETE" -> "Your face enrolment isn't complete. Ask HR to reset it so you can enrol again.";
            case "FACE_LOCKED" -> "The face check for " + name + " is locked after several failed tries. It unlocks by itself after a while, or HR can reset it.";
            case "FAIL_MATCH", "FAIL_MATCH_INCONSISTENT" -> "The face didn't match " + name + ". If this is you, look straight at the camera in even light and try again.";
            case "FAIL_LIVENESS" -> "We couldn't confirm a live face. Blink while looking at the camera, then try again.";
            case "FAIL_NO_FACE" -> "We can't see a face. Keep your face inside the guide and try again.";
            case "FAIL_MULTIPLE_FACES" -> "More than one face is in the picture. Only one person at a time, please.";
            case "FAIL_LOW_QUALITY" -> "The picture wasn't sharp enough. Hold still, in even light, and try again.";
            case "FACE_WORKER_UNAVAILABLE", "FACE_WORKER_BAD_RESPONSE" -> "The face check isn't available right now. Try again in a moment.";
            default -> original.isEmpty() ? "The face check couldn't complete. Please try again." : original;
        };
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        return new HrmsException(message, status != null ? status : HttpStatus.FORBIDDEN, code);
    }

    // ── setting up (admin / HR) ──────────────────────────────────────────────

    public List<FaceStations.Station> list(Jwt jwt) {
        requireManager(jwt);
        return stations.list(callerCompany(jwt));
    }

    public FaceStations.Station create(Jwt jwt, CreateRequest req) {
        requireManager(jwt);
        stations.requireReady();
        String name = cleanName(req == null ? null : req.name());
        if (name == null)
            throw new BusinessRuleException("Give the station a name of " + NAME_MIN + " to " + NAME_MAX + " characters, like \"Front desk\".", "STATION_NAME_INVALID");
        if (req.branchId() == null) throw new BusinessRuleException("Choose the branch the station is at.", "STATION_BRANCH_REQUIRED");
        Branch branch = branches.findById(req.branchId())
                .orElseThrow(() -> new ResourceNotFoundException("That branch wasn't found."));
        if (!branch.isActive()) throw new BusinessRuleException("That branch is inactive. Choose an active branch.", "STATION_BRANCH_INACTIVE");
        UUID company = callerCompany(jwt);
        if (company != null && !company.equals(branch.getCompanyId()))
            throw new HrmsException("That branch belongs to another company.", HttpStatus.FORBIDDEN, "STATION_OTHER_COMPANY");
        Caller who = caller(jwt);
        UUID id = stations.create(tenantOf(jwt), branch.getCompanyId(), branch.getId(), name, who.userId(), who.name());
        audit("FACE_STATION_CREATED", id, "%s set up the face station \"%s\" at %s.".formatted(who.name(), name, branch.getName()));
        return stations.find(id);
    }

    public FaceStations.Station revoke(Jwt jwt, UUID id) {
        FaceStations.Station s = ownStation(jwt, id);
        Caller who = caller(jwt);
        if (stations.revoke(id, who.userId(), who.name()))
            audit("FACE_STATION_REVOKED", id, "%s switched off the face station \"%s\". Its devices can no longer punch.".formatted(who.name(), s.name()));
        return stations.find(id);
    }

    public void delete(Jwt jwt, UUID id) {
        FaceStations.Station s = ownStation(jwt, id);
        if (stations.punchCount(id) > 0 || !stations.delete(id))
            throw new HrmsException("This station has made punches, so it is kept as a record. Switch it off instead.", HttpStatus.CONFLICT, "STATION_HAS_PUNCHES");
        audit("FACE_STATION_DELETED", id, "%s deleted the face station \"%s\".".formatted(caller(jwt).name(), s.name()));
    }

    /** A station token for the device the admin is on. The admin's own session there should be signed out next. */
    public DeviceSession startOnDevice(Jwt jwt, UUID id) {
        FaceStations.Station s = ownStation(jwt, id);
        if (!s.active()) throw new HrmsException("This station is switched off. Set up a new one.", HttpStatus.CONFLICT, "STATION_REVOKED");
        Caller who = caller(jwt);
        stations.markStarted(id, who.name());
        audit("FACE_STATION_STARTED", id, "%s started the face station \"%s\" on a device.".formatted(who.name(), s.name()));
        return session(s, tenantOf(jwt));
    }

    // ── at the station (station token) ───────────────────────────────────────

    public StationInfo me(Jwt jwt) {
        FaceStations.Station s = requireStation(jwt);
        return info(s);
    }

    /** A fresh token for a running station (the device renews it every day). */
    public DeviceSession renew(Jwt jwt) {
        FaceStations.Station s = requireStation(jwt);
        return session(s, tenantOf(jwt));
    }

    public PeopleList people(Jwt jwt, String q) {
        FaceStations.Station s = requireStation(jwt);
        String query = searchText(q);
        if (query == null) return new PeopleList(List.of(), false, "Type at least " + SEARCH_MIN + " letters of your name or your employee code.");
        UUID defaultBranch = defaultBranch(s.companyId());
        List<Employee> matches = employees.findActiveByCompany(s.companyId()).stream()
                .filter(AssistedPunchService::isWorking)
                .filter(e -> worksAt(e, s.companyId(), s.branchId(), defaultBranch))
                .filter(e -> Objects.toString(AssistedPunchService.name(e), "").toLowerCase(Locale.ROOT).contains(query)
                        || Objects.toString(e.getEmployeeCode(), "").toLowerCase(Locale.ROOT).contains(query))
                .sorted(Comparator.comparing(e -> Objects.toString(AssistedPunchService.name(e), "").toLowerCase(Locale.ROOT)))
                .toList();
        boolean truncated = matches.size() > SEARCH_LIMIT;
        List<Employee> page = truncated ? matches.subList(0, SEARCH_LIMIT) : matches;
        Map<UUID, String> faces = assisted.faceStatuses(tenantOf(jwt), page.stream().map(Employee::getId).toList());
        Map<UUID, String> depts = departmentNames(page);
        return new PeopleList(page.stream().map(e -> new StationPerson(e.getId(), AssistedPunchService.name(e), e.getEmployeeCode(),
                e.getDepartmentId() != null ? depts.get(e.getDepartmentId()) : null,
                faceReady(faces.getOrDefault(e.getId(), "NO_LOGIN"))))
                .toList(), truncated, page.isEmpty() ? "No one at " + Objects.toString(s.branchName(), "this branch") + " matches." : null);
    }

    public PunchResult punch(Jwt jwt, PunchRequest req) {
        FaceStations.Station s = requireStation(jwt);
        if (req == null || req.employeeId() == null) throw new BusinessRuleException("Find your name first.", "EMPLOYEE_REQUIRED");
        AssistedPunchService.PunchType type = AssistedPunchService.PunchType.parse(req.type());
        if (req.imageBase64() == null || req.imageBase64().isBlank())
            throw new BusinessRuleException("Look at the camera first.", "FACE_IMAGE_REQUIRED");
        if (!BASE64.matcher(req.imageBase64()).matches())
            throw new BusinessRuleException("The photo couldn't be read. Try again.", "FACE_IMAGE_INVALID");
        if (req.latitude() == null || req.longitude() == null || Math.abs(req.latitude()) > 90 || Math.abs(req.longitude()) > 180)
            throw new BusinessRuleException("This station's location is needed to punch. Ask your admin to turn on location for it.", "LOCATION_REQUIRED");

        UUID tenantId = tenantOf(jwt);
        Employee target = employees.findById(req.employeeId())
                .orElseThrow(() -> new ResourceNotFoundException("That person wasn't found."));
        String name = AssistedPunchService.name(target);
        if (!worksAt(target, s.companyId(), s.branchId(), target.getBranchId() == null ? defaultBranch(s.companyId()) : null))
            throw new HrmsException(name + " doesn't work at " + Objects.toString(s.branchName(), "this branch")
                    + ", so they can't punch at this station.", HttpStatus.FORBIDDEN, "STATION_OTHER_BRANCH");
        if (!AssistedPunchService.isWorking(target))
            throw new BusinessRuleException(name + " isn't an active employee, so they can't punch.", "ASSISTED_PUNCH_NOT_ACTIVE");

        UUID targetLogin = assisted.faceLoginOf(tenantId, target.getId());
        if (targetLogin == null)
            throw new HrmsException(name + " has no app login, so there is no enrolled face to check. Ask HR.", HttpStatus.CONFLICT, "FACE_NOT_ENROLLED");
        FaceDtos.EnrollmentStatus enrolment = faceService.getStatus(tenantId, targetLogin).status();
        if (enrolment != FaceDtos.EnrollmentStatus.ACTIVE && enrolment != FaceDtos.EnrollmentStatus.LOCKED)
            throw new HrmsException("You haven't enrolled your face yet. Enrol it once in the app, then punch here.", HttpStatus.CONFLICT, "FACE_NOT_ENROLLED");

        AttendanceDto today = attendanceService.getTodayRecord(target.getId()).orElse(null);
        if (type == AssistedPunchService.PunchType.CHECK_IN && today != null && today.checkInTime() != null)
            throw new HrmsException(name + " already punched in today at " + AssistedPunchService.clock(today.checkInTime()) + ".", HttpStatus.CONFLICT, "ALREADY_CHECKED_IN");
        if (type == AssistedPunchService.PunchType.CHECK_OUT && today != null && today.checkOutTime() != null)
            throw new HrmsException(name + " already punched out today at " + AssistedPunchService.clock(today.checkOutTime()) + ".", HttpStatus.CONFLICT, "ALREADY_CHECKED_OUT");
        if (type == AssistedPunchService.PunchType.CHECK_OUT && (today == null || today.checkInTime() == null) && !assisted.openSinceYesterday(target.getId()))
            throw new HrmsException(name + " hasn't punched in today, so there is nothing to punch out.", HttpStatus.CONFLICT, "NOT_CHECKED_IN");

        // The station must be inside the person's work area, by the self punch's rule.
        double lat = req.latitude(), lon = req.longitude();
        AttendanceContextResolver.Context ctx = contextResolver.resolve(target.getId());
        GeoValidateResponse geo = geoValidationService.validate(new GeoValidateRequest(target.getId(), lat, lon),
                ctx.branchId(), ctx.branchLat(), ctx.branchLon(), ctx.geoFenceRadius());
        boolean wfhDay = attendanceService.isApprovedWfhDay(target.getId(), LocalDate.now(IST));
        boolean anywhere = punchRules != null && punchRules.allowAnywhere(target.getId());
        if (AssistedPunchService.zoneBlocks(geo.withinFence(), geofenceEnforce, assisted.companyRequiresGeofence(ctx.companyId()), wfhDay || anywhere)) {
            String place = ctx.branchName() != null ? ctx.branchName() : "the office";
            String away = geo.distanceMeters() != null ? ", about " + Math.round(geo.distanceMeters()) + " m away" : "";
            throw new BusinessRuleException("This station is outside " + AssistedPunchService.firstName(name) + "'s work area (" + place + away
                    + "). Ask your admin to check where the station is set up.", "OUTSIDE_GEOFENCE");
        }

        // The face must match THIS person's enrolment.
        String device = FacePunchDevices.label("Station · " + s.name());
        FaceDtos.VerifyResponse verified;
        try {
            verified = faceService.verify(tenantId, targetLogin,
                    new FaceDtos.VerifyRequest(req.imageBase64(), req.challengePerformed(), lat, lon, device), type.facePurpose);
        } catch (ResponseStatusException ex) {
            throw faceRefusal(ex, name);
        }
        String bucket = verified != null ? verified.scoreBucket() : null;
        boolean needsApproval = needsApproval(bucket);

        // The punch, "punched by" the station, and the station's own row, together.
        AssistedPunchRecorder.PunchedBy by = new AssistedPunchRecorder.PunchedBy(null, null, s.name() + " (station)",
                lat, lon, req.accuracy(), geo.distanceMeters() != null ? (int) Math.round(geo.distanceMeters()) : null,
                geo.withinFence(), device, recorder.latestPassedFaceEvent(tenantId, targetLogin, type.facePurpose));
        AssistedPunchRecorder.Target t = new AssistedPunchRecorder.Target(target.getId(), ctx.companyId(), ctx.branchId(),
                ctx.departmentId(), ctx.branchName());
        AttendanceDto dto;
        try {
            dto = tx.execute(status -> {
                AttendanceDto d = type == AssistedPunchService.PunchType.CHECK_IN
                        ? recorder.checkIn(tenantId, t, req.imageBase64(), wfhDay, by)
                        : recorder.checkOut(tenantId, t, by);
                String at = type == AssistedPunchService.PunchType.CHECK_IN ? d.checkInTime() : d.checkOutTime();
                stations.recordPunch(tenantId, s.id(), d.id(), target.getId(), LocalDate.parse(d.attendanceDate()),
                        type.name(), parse(at), by.faceEventId(), bucket, needsApproval);
                return d;
            });
        } catch (ResourceNotFoundException noOpenDay) {
            throw new HrmsException(name + " hasn't punched in today, so there is nothing to punch out.", HttpStatus.CONFLICT, "NOT_CHECKED_IN");
        } catch (AssistedPunchRecorder.AlreadyPunchedOut done) {
            throw new HrmsException(name + " already punched out today at " + AssistedPunchService.clock(done.checkOutTime()) + ".", HttpStatus.CONFLICT, "ALREADY_CHECKED_OUT");
        }
        if (dto == null) throw new IllegalStateException("The punch wasn't saved.");

        if (type == AssistedPunchService.PunchType.CHECK_IN && !geo.withinFence() && !wfhDay && !anywhere && reviewService != null && dto.id() != null) {
            try {
                reviewService.flagOutsideGeofence(dto.id(), LocalDate.parse(dto.attendanceDate()), geo.distanceMeters());
            } catch (RuntimeException e) {
                log.warn("Could not flag an outside-zone station check-in {}: {}", dto.id(), e.getMessage());
            }
        }
        try {
            stations.markUsed(s.id());
        } catch (RuntimeException e) {
            log.warn("Could not mark face station {} as used: {}", s.id(), e.getMessage());
        }
        String at = type == AssistedPunchService.PunchType.CHECK_IN ? dto.checkInTime() : dto.checkOutTime();
        audit(type == AssistedPunchService.PunchType.CHECK_IN ? "STATION_PUNCH_IN" : "STATION_PUNCH_OUT", target.getId(),
                "%s punched %s at %s at the face station \"%s\"%s.".formatted(name,
                        type == AssistedPunchService.PunchType.CHECK_IN ? "in" : "out", AssistedPunchService.clock(at), s.name(),
                        needsApproval ? " (match not certain: waiting for the manager's approval)" : ""));
        String dept = target.getDepartmentId() != null ? departmentNames(List.of(target)).get(target.getDepartmentId()) : null;
        return new PunchResult(target.getId(), name, target.getEmployeeCode(), dept, target.getJobTitle(), type.name(), at,
                dto.attendanceStatus(), dto.locationName(), needsApproval, s.name());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** The station behind a station token, still switched on; anything else is refused. */
    FaceStations.Station requireStation(Jwt jwt) {
        if (!isStationToken(jwt))
            throw new HrmsException("Only a face station can do this.", HttpStatus.FORBIDDEN, "STATION_ONLY");
        stations.requireReady();
        UUID id;
        try {
            id = UUID.fromString(jwt.getClaimAsString("station_id"));
        } catch (RuntimeException e) {
            throw new HrmsException("This station's sign-in isn't valid. Ask your admin to start it again.", HttpStatus.UNAUTHORIZED, "STATION_REVOKED");
        }
        FaceStations.Station s = stations.find(id);
        if (s == null || !s.active())
            throw new HrmsException("This station was switched off by your admin. Ask them to start it again.", HttpStatus.UNAUTHORIZED, "STATION_REVOKED");
        return s;
    }

    private void requireManager(Jwt jwt) {
        if (!canManage(jwt))
            throw new HrmsException("Setting up face stations needs the attendance settings and punch-for-anyone permissions.", HttpStatus.FORBIDDEN, "STATION_NOT_ALLOWED");
    }

    /** A station in the caller's company (or workspace, for a login without an employee record). */
    private FaceStations.Station ownStation(Jwt jwt, UUID id) {
        requireManager(jwt);
        FaceStations.Station s = stations.find(id);
        UUID company = callerCompany(jwt);
        if (s == null || (company != null && !company.equals(s.companyId())))
            throw new ResourceNotFoundException("That station wasn't found.");
        return s;
    }

    private DeviceSession session(FaceStations.Station s, UUID tenantId) {
        JwtService.IssuedToken token = jwtService.issueStationToken(s.id(), tenantId, TOKEN_TTL);
        return new DeviceSession(token.token(), token.expiresAt(), info(s));
    }

    private static StationInfo info(FaceStations.Station s) {
        return new StationInfo(s.id(), s.name(), s.branchId(), s.branchName());
    }

    /** The company's default branch for people placed at none: HQ, else the first active one (AttendanceContextResolver). */
    private UUID defaultBranch(UUID companyId) {
        List<Branch> active = branches.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId);
        if (active.isEmpty()) return null;
        return active.stream().filter(Branch::isHeadquarters).findFirst().orElse(active.get(0)).getId();
    }

    /** The caller's company, or null when the login has no employee record (row-level security keeps it to the workspace). */
    private UUID callerCompany(Jwt jwt) {
        try {
            return employees.findById(AttendanceReviewService.callerEmployeeId(jwt)).map(Employee::getCompanyId).orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private record Caller(UUID userId, String name) {}

    private Caller caller(Jwt jwt) {
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (RuntimeException ignored) { /* non-UUID subject */ }
        String name = null;
        try {
            name = employees.findById(AttendanceReviewService.callerEmployeeId(jwt)).map(AssistedPunchService::name).orElse(null);
        } catch (RuntimeException ignored) { /* no employee record */ }
        if (name == null || name.isBlank()) name = jwt.getClaimAsString("email");
        return new Caller(userId, name);
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

    private static Instant parse(String iso) {
        try {
            return iso != null ? Instant.parse(iso) : Instant.now();
        } catch (RuntimeException e) {
            return Instant.now();
        }
    }

    private void audit(String action, UUID entityId, String summary) {
        if (audit == null) return;
        try {
            audit.record("attendance", action, action.startsWith("STATION_PUNCH") ? "employee" : "face_station", entityId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for {}: {}", action, e.getMessage());
        }
    }
}
