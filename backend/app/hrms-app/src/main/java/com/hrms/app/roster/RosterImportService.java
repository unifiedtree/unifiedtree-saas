package com.hrms.app.roster;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.PlannerScope;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.ImportValidation;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanCell;
import com.hrms.api.roster.RosterContract.PlanDay;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlanRow;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.api.roster.RosterDrafts;
import com.hrms.api.roster.RosterPlanning;
import com.hrms.api.roster.RosterService;
import com.hrms.api.roster.RosterStore;
import com.hrms.api.roster.RosterTables;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.api.roster.plan.PlanFactsLoader;
import com.hrms.api.roster.plan.PlannerPeople;
import com.hrms.api.roster.plan.RosterPlanner;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The shift roster's Excel import, template and export (design §1.7, endpoints 20–23).
 *
 * <ul>
 *   <li><b>Validate</b> (writes nothing): read the file ({@link RosterSheetParser}), match people and check every
 *       cell ({@link RosterImportCheck}), then run the planner on the result ({@link PlanFactsLoader} +
 *       {@link RosterPlanner}, no regeneration, members in sheet order, staffing empty or the target draft's), so
 *       the preview shows the same coverage and schedule checks the planner shows.</li>
 *   <li><b>Apply</b>: validate again (the same file) and refuse while the file has any error; then save a DRAFT
 *       through {@link RosterDrafts} (source IMPORT), or replace the members and days of a draft that was never
 *       published. An import never publishes and never changes an employee record.</li>
 *   <li><b>Template</b>: the S13 layout with the people in scope filled in and the days empty.</li>
 *   <li><b>Export</b>: a roster's working copy (or its published days) in the same layout, so it can be imported
 *       again.</li>
 * </ul>
 * Who may do it is the planner's rule ({@link PlannerScope}): a department head only for the departments they head.
 * Every call answers FEATURE_NOT_READY while shift planning's tables are missing, or while its beans
 * ({@code com.hrms.api.roster}) are not part of the running build.
 */
@Service
public class RosterImportService {

    private static final Logger log = LoggerFactory.getLogger(RosterImportService.class);

    /** Empty rows under the people in the template that still offer the code drop-down. */
    static final int TEMPLATE_SPARE_ROWS = 50;

    // Shift planning's own beans (com.hrms.api.roster), looked up when a call needs them: this package is always
    // scanned (com.hrms.app), theirs only where a profile lists it, and a missing one must never stop the app from
    // starting. A call that needs one that isn't there answers FEATURE_NOT_READY instead.
    private final Supplier<PlannerScope> scope;
    private final Supplier<RosterDrafts> drafts;
    private final Supplier<RosterService> rosters;
    private final Supplier<RosterStore> store;
    private final Supplier<RosterTables> tables;
    private final Supplier<RosterPlanning> planning;
    private final Supplier<PlannerPeople> people;
    private final Supplier<PlanFactsLoader> facts;

    @Autowired(required = false)
    private CompanyAccessService companyAccess;

    @Autowired
    public RosterImportService(ObjectProvider<PlannerScope> scope, ObjectProvider<RosterDrafts> drafts,
                               ObjectProvider<RosterService> rosters, ObjectProvider<RosterStore> store,
                               ObjectProvider<RosterTables> tables, ObjectProvider<RosterPlanning> planning,
                               ObjectProvider<PlannerPeople> people, ObjectProvider<PlanFactsLoader> facts) {
        this.scope = scope::getIfAvailable;
        this.drafts = drafts::getIfAvailable;
        this.rosters = rosters::getIfAvailable;
        this.store = store::getIfAvailable;
        this.tables = tables::getIfAvailable;
        this.planning = planning::getIfAvailable;
        this.people = people::getIfAvailable;
        this.facts = facts::getIfAvailable;
    }

    /** Tests: the collaborators themselves (any of them may be null = "not in this build"). */
    RosterImportService(PlannerScope scope, RosterDrafts drafts, RosterService rosters, RosterStore store,
                        RosterTables tables, RosterPlanning planning, PlannerPeople people, PlanFactsLoader facts) {
        this.scope = () -> scope;
        this.drafts = () -> drafts;
        this.rosters = () -> rosters;
        this.store = () -> store;
        this.tables = () -> tables;
        this.planning = () -> planning;
        this.people = () -> people;
        this.facts = () -> facts;
    }

    private PlannerScope scope() { return need(scope); }
    private RosterDrafts drafts() { return need(drafts); }
    private RosterService rosters() { return need(rosters); }
    private RosterStore store() { return need(store); }
    private RosterTables tables() { return need(tables); }
    private RosterPlanning planning() { return need(planning); }
    private PlannerPeople people() { return need(people); }
    private PlanFactsLoader facts() { return need(facts); }

    private static <T> T need(Supplier<T> bean) {
        T t = bean.get();
        if (t == null) throw new FeatureNotReady();
        return t;
    }

    /** Tests: the company-access check (optional, as everywhere else). */
    void setCompanyAccess(CompanyAccessService companyAccess) {
        this.companyAccess = companyAccess;
    }

    /** The roster a file is for: the period and the optional department and building ("Building" = branch). */
    public record Scope(UUID companyId, LocalDate startDate, LocalDate endDate, UUID departmentId, UUID branchId) {}

    /** A file to download. */
    public record Download(String fileName, byte[] bytes) {}

    // ── validate and apply ───────────────────────────────────────────────────

    /** Endpoint 21: what the file would import, its problems and the planner's preview. Writes nothing. */
    @Transactional(readOnly = true)
    public ImportValidation validate(Jwt jwt, MultipartFile file, Scope s, UUID rosterId) {
        return check(jwt, file, s, rosterId).validation();
    }

    /**
     * Endpoint 22: creates a DRAFT roster from the file ({@code rosterId} null), or replaces the members and days of
     * the never-published draft {@code rosterId} ({@code lockVersion} must match). Refused while the file has any
     * error (400 IMPORT_FILE_INVALID).
     *
     * @param name the new roster's name; blank = the planner's default ("January 2027 · Technical"), or the draft's
     *             own name when replacing
     */
    @Transactional
    public Applied apply(Jwt jwt, MultipartFile file, Scope s, String name, UUID rosterId, Integer lockVersion) {
        Checked c = check(jwt, file, s, rosterId);
        int errors = c.validation().summary().errors();
        if (errors > 0) {
            throw RosterImportErrors.fileInvalid("The file still has " + errors + (errors == 1 ? " error" : " errors")
                    + ". Fix " + (errors == 1 ? "it" : "them") + " and upload the file again.");
        }
        if (c.outcome().members().isEmpty()) {
            throw RosterImportErrors.fileInvalid("No one in the file could be matched, so there is nothing to import.");
        }
        String clean = name == null ? "" : name.replaceAll("\\s+", " ").trim();
        if (clean.isEmpty() && c.target() != null) clean = c.target().name();
        DraftBody body = new DraftBody(clean, periodType(s.startDate(), s.endDate()), s.startDate(), s.endDate(),
                s.departmentId(), s.branchId(), c.config(), c.outcome().members(), c.staffing(), c.outcome().cells(),
                rosterId == null ? null : lockVersion);
        if (rosterId == null) {
            RosterDetail created = drafts().create(s.companyId(), body, c.actor(), RosterDrafts.SOURCE_IMPORT);
            log.info("Roster import: draft {} created from '{}' ({} people)", created.roster().id(), file.getOriginalFilename(),
                    c.outcome().members().size());
            return new Applied(created, true);
        }
        if (lockVersion == null) {
            throw RosterImportErrors.fileInvalid("Send the draft's lockVersion to replace its days.");
        }
        RosterDetail replaced = drafts().replace(rosterId, body, c.actor());
        log.info("Roster import: draft {} replaced from '{}' ({} people)", rosterId, file.getOriginalFilename(),
                c.outcome().members().size());
        return new Applied(replaced, false);
    }

    /** What apply saved; {@code created} = a new draft (else an existing draft's days were replaced). */
    public record Applied(RosterDetail detail, boolean created) {}

    /** One validation and everything apply needs from it. */
    record Checked(ImportValidation validation, RosterImportCheck.Outcome outcome, RosterConfig config,
                   List<StaffingIn> staffing, Actor actor, RosterStore.Header target) {}

    Checked check(Jwt jwt, MultipartFile file, Scope s, UUID rosterId) {
        tables().require();
        if (s == null || s.companyId() == null) throw RosterImportErrors.fileInvalid("Choose the company first.");
        RosterPlanner.requireValidRange(s.startDate(), s.endDate());
        // The multipart form may carry companyId outside the query string, where the company-access filter looks.
        if (companyAccess != null) companyAccess.checkBodyCompany(s.companyId());
        UUID tenant = TenantContext.requireTenantId();
        Actor actor = planner(jwt, s.companyId(), s.departmentId());

        RosterStore.Header target = null;
        List<StaffingIn> staffing = List.of();
        if (rosterId != null) {
            target = rosters().load(tenant, rosterId, false);
            rosters().editor(jwt, target);
            requireReplaceable(target, s);
            staffing = store().staffing(tenant, rosterId);
        }

        RosterSheetParser.ParsedSheet sheet = RosterSheetParser.parse(file == null ? null : file.getOriginalFilename(),
                bytes(file), s.startDate(), s.endDate());
        List<PlannerPerson> candidates = people().list(tenant, s.companyId(), null, null, null, s.startDate(), s.endDate());
        RosterImportCheck.Target t = new RosterImportCheck.Target(s.companyId(), s.startDate(), s.endDate(),
                s.departmentId(), name(tenant, s.departmentId(), null), s.branchId(), name(tenant, null, s.branchId()),
                actor.companyWide(), actor.headedDepartmentIds() == null ? Set.of() : actor.headedDepartmentIds());
        RosterImportCheck.Matching matching = RosterImportCheck.match(sheet, candidates, t);
        PlanFacts loaded = facts().load(tenant, s.companyId(), rosterId, matching.employeeIds(), s.startDate().minusDays(1), s.endDate());
        if (loaded == null) throw new FeatureNotReady();
        RosterImportCheck.Outcome outcome = RosterImportCheck.cells(sheet, matching, loaded, t);
        RosterConfig config = config(outcome);

        PlanResponse plan = null;
        if (!outcome.members().isEmpty()) {
            plan = RosterPlanner.plan(new PlanRequest(s.startDate(), s.endDate(), s.departmentId(), s.branchId(), rosterId,
                    config, outcome.members(), staffing, outcome.cells(), false, false), loaded.withPlanner(actor));
        }
        ImportValidation v = new ImportValidation(s.startDate(), s.endDate(), sheet.sheetName(), sheet.headerRow(),
                outcome.rows(), outcome.listed(), outcome.summary(), plan);
        return new Checked(v, outcome, config, staffing, actor, target);
    }

    /**
     * The imported roster's wizard choices (design §1.7): no pattern, weekly offs as the file says them (CUSTOM),
     * everyone from the same start day; the shifts the file uses as the coverage columns; its people's designations.
     */
    static RosterConfig config(RosterImportCheck.Outcome o) {
        return new RosterConfig(null, List.of(), true, WeeklyOffMode.CUSTOM, StaggerMode.SAME, null, o.shiftIds(), o.designationIds());
    }

    /** An import replaces only a draft that was never published, for the same period, department and building. */
    private static void requireReplaceable(RosterStore.Header h, Scope s) {
        if (!h.companyId().equals(s.companyId())) throw RosterImportErrors.scope("This roster belongs to another company.");
        if (h.status() != RosterStatus.DRAFT || h.version() > 0) throw RosterImportErrors.published();
        if (!h.startDate().equals(s.startDate()) || !h.endDate().equals(s.endDate())
                || !Objects.equals(h.departmentId(), s.departmentId()) || !Objects.equals(h.branchId(), s.branchId())) {
            throw RosterImportErrors.rangeInvalid("The draft '" + h.name() + "' covers " + RosterImportCheck.period(h.startDate(), h.endDate())
                    + (h.departmentName() == null ? "" : ", " + h.departmentName()) + (h.branchName() == null ? "" : ", " + h.branchName())
                    + ". Choose the same period, department and building to replace its days.");
        }
    }

    private static PeriodType periodType(LocalDate start, LocalDate end) {
        return start.getDayOfMonth() == 1 && end.equals(start.withDayOfMonth(start.lengthOfMonth())) ? PeriodType.MONTH : PeriodType.RANGE;
    }

    private static byte[] bytes(MultipartFile file) {
        if (file == null || file.isEmpty()) throw RosterImportErrors.fileInvalid("Choose a file to upload.");
        if (file.getSize() > RosterSheetLayout.MAX_FILE_BYTES) {
            throw RosterImportErrors.fileInvalid("The file is larger than 2 MB. Remove other sheets or split it, then upload it again.");
        }
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw RosterImportErrors.fileInvalid("The file couldn't be read. Upload it again.");
        }
    }

    // ── template ─────────────────────────────────────────────────────────────

    /** Endpoint 20: the S13 sheet with the people in scope filled in and the days empty. */
    @Transactional(readOnly = true)
    public Download template(Jwt jwt, Scope s) {
        tables().require();
        if (s == null || s.companyId() == null) throw RosterImportErrors.fileInvalid("Choose the company first.");
        RosterPlanner.requireValidRange(s.startDate(), s.endDate());
        UUID tenant = TenantContext.requireTenantId();
        Actor actor = planner(jwt, s.companyId(), s.departmentId());
        List<PlannerPerson> inScope = people().list(tenant, s.companyId(), s.departmentId(), s.branchId(),
                actor.companyWide() ? null : actor.headedDepartmentIds(), s.startDate(), s.endDate());
        PlanFacts f = facts().load(tenant, s.companyId(), null, List.of(), s.startDate().minusDays(1), s.endDate());
        if (f == null) throw new FeatureNotReady();
        int days = RosterSheetParser.days(s.startDate(), s.endDate());
        List<RosterSheetWriter.SheetPerson> rows = new ArrayList<>(inScope.size());
        for (PlannerPerson p : inScope) {
            rows.add(new RosterSheetWriter.SheetPerson(p.name(), p.code(), p.departmentName(), p.designationName(), p.branchName(),
                    Arrays.asList(new String[days])));
        }
        String scopeName = name(tenant, s.departmentId(), s.branchId());
        String title = "Roster — " + RosterImportCheck.period(s.startDate(), s.endDate()) + (scopeName == null ? "" : " — " + scopeName);
        byte[] bytes = RosterSheetWriter.write(new RosterSheetWriter.Spec(title, s.startDate(), s.endDate(), sheetShifts(f, s.companyId()),
                uncodedShifts(f, s.companyId()), f.holidays(), rows, TEMPLATE_SPARE_ROWS));
        return new Download("roster-template-" + s.startDate() + "-to-" + s.endDate() + ".xlsx", bytes);
    }

    // ── export ───────────────────────────────────────────────────────────────

    /**
     * Endpoint 23: the roster's working copy ({@code published} false) or its published days, in the template's
     * layout. A day with nothing planned shows the holiday or the approved leave on it (PH, L, COFF), as the client's
     * sheet does; importing the file again gives the same days.
     */
    @Transactional(readOnly = true)
    public Download export(Jwt jwt, UUID rosterId, boolean published) {
        tables().require();
        UUID tenant = TenantContext.requireTenantId();
        RosterStore.Header h = rosters().load(tenant, rosterId, false);
        Actor actor = rosters().reader(jwt, h);
        List<MemberIn> members = new ArrayList<>(store().members(tenant, rosterId));
        Map<UUID, Map<LocalDate, String>> tokens = new LinkedHashMap<>();
        if (published) {
            Set<UUID> listed = new LinkedHashSet<>();
            for (MemberIn m : members) listed.add(m.employeeId());
            for (RosterStore.Day d : store().rosterDays(tenant, rosterId, h.startDate(), false)) {
                if (d.date().isAfter(h.endDate())) continue;
                if (listed.add(d.employeeId())) members.add(new MemberIn(d.employeeId(), 0));
                tokens.computeIfAbsent(d.employeeId(), k -> new LinkedHashMap<>()).put(d.date(), d.token());
            }
        } else {
            for (RosterStore.Cell c : store().cells(tenant, rosterId)) {
                tokens.computeIfAbsent(c.employeeId(), k -> new LinkedHashMap<>()).put(c.date(), c.token());
            }
        }
        int days = RosterSheetParser.days(h.startDate(), h.endDate());
        List<RowIn> rows = new ArrayList<>(members.size());
        for (MemberIn m : members) {
            String[] row = new String[days];
            tokens.getOrDefault(m.employeeId(), Map.of()).forEach((d, t) -> {
                int i = (int) ChronoUnit.DAYS.between(h.startDate(), d);
                if (i >= 0 && i < days) row[i] = t;
            });
            rows.add(new RowIn(m.employeeId(), Arrays.asList(row), List.of()));
        }
        PlanResponse plan = planning().plan(tenant, h.companyId(), new PlanRequest(h.startDate(), h.endDate(), h.departmentId(),
                h.branchId(), h.id(), h.config(), members, store().staffing(tenant, rosterId), rows, false, true), actor)
                .orElseThrow(FeatureNotReady::new);
        PlanFacts f = facts().load(tenant, h.companyId(), h.id(), List.of(), h.startDate().minusDays(1), h.endDate());
        if (f == null) throw new FeatureNotReady();

        List<RosterSheetWriter.SheetPerson> sheetPeople = new ArrayList<>(plan.rows().size());
        for (PlanRow r : plan.rows()) sheetPeople.add(new RosterSheetWriter.SheetPerson(r.employeeName(), r.employeeCode(),
                r.departmentName(), r.designationName(), r.branchName(), exportCodes(r)));
        Map<LocalDate, String> holidays = new LinkedHashMap<>();
        for (PlanDay d : plan.days()) if (d.holidayName() != null) holidays.put(d.date(), d.holidayName());
        String title = "Roster — " + h.name() + (published ? " — published days" : "");
        byte[] bytes = RosterSheetWriter.write(new RosterSheetWriter.Spec(title, h.startDate(), h.endDate(), sheetShifts(f, h.companyId()),
                uncodedShifts(f, h.companyId()), holidays, sheetPeople, 0));
        return new Download(fileName(h.name()) + (published ? " (published)" : "") + ".xlsx", bytes);
    }

    /**
     * The codes of an exported row: the planned code; on an empty day the overlay (PH, L or COFF); nothing before
     * joining or after the last working day. A shift with no code shows its name's first letters (the planner's
     * rule), which the import then reports as unknown, as the Codes sheet says.
     */
    static List<String> exportCodes(PlanRow r) {
        List<String> out = new ArrayList<>(r.cells().size());
        for (PlanCell c : r.cells()) {
            if (c.code() != null) out.add(c.code());
            else if (c.overlay() != null && !c.outside()) out.add(c.overlay().type().name());
            else out.add(null);
        }
        return out;
    }

    // ── shared ───────────────────────────────────────────────────────────────

    /** The caller as a planner of the company; a department head must name one of their departments. */
    private Actor planner(Jwt jwt, UUID companyId, UUID departmentId) {
        Actor actor = scope().actor(jwt, companyId);
        if (!actor.companyWide()) scope().check(actor, departmentId, List.of());
        return actor;
    }

    /** The company's active shifts with a code, by code (the Codes sheet and the drop-down). */
    static List<RosterSheetWriter.SheetShift> sheetShifts(PlanFacts f, UUID companyId) {
        return f.shifts().values().stream()
                .filter(s -> s.active() && companyId.equals(s.companyId()) && s.code() != null && !s.code().isBlank())
                .sorted(Comparator.comparing((PlanFacts.Shift s) -> s.code().trim(), String.CASE_INSENSITIVE_ORDER))
                .map(s -> new RosterSheetWriter.SheetShift(s.code().trim(), s.name(), s.start(), s.end(), s.night()))
                .toList();
    }

    /** The company's active shifts that have no code (they can't be imported until they get one). */
    static List<String> uncodedShifts(PlanFacts f, UUID companyId) {
        return f.shifts().values().stream()
                .filter(s -> s.active() && companyId.equals(s.companyId()) && (s.code() == null || s.code().isBlank()))
                .map(PlanFacts.Shift::name).filter(Objects::nonNull).sorted(String.CASE_INSENSITIVE_ORDER).toList();
    }

    /** A department's and/or branch's name ("Technical · Building 2"), or null. */
    private String name(UUID tenant, UUID departmentId, UUID branchId) {
        if (departmentId == null && branchId == null) return null;
        return store().scopeName(tenant, departmentId, branchId);
    }

    /** A file name from a roster name: letters, digits, spaces, dots, dashes and underscores only. */
    static String fileName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^A-Za-z0-9 ._-]+", " ").replaceAll("\\s+", " ").trim();
        return clean.isEmpty() ? "Roster" : clean;
    }
}
