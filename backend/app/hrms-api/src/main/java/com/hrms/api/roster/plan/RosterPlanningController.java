package com.hrms.api.roster.plan;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.PlannerScope;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The shift planner's two read-only endpoints (design §1.5, endpoints 8 and 9). Both need
 * {@code attendance.roster.plan} and go through {@link PlannerScope}: a department planner works only in the
 * departments they head ({@code ROSTER_SCOPE} otherwise). The {@code companyId} parameter is checked by the
 * company-access filter like every other {@code ?companyId=}.
 *
 * <ul>
 *   <li>{@code GET /v1/rosters/people?companyId=&departmentId=&branchId=&from=&to=} → {@code PlannerPerson[]}
 *       ({@link PlannerPeople}).</li>
 *   <li>{@code POST /v1/rosters/preview?companyId=} {@code PlanRequest} → {@code PlanResponse}: the live preview.
 *       Stateless; it saves nothing. Every change in the planner sends it: the facts are loaded
 *       ({@link PlanFactsLoader}, from the day before the period for the rest check) and
 *       {@link RosterPlanner#plan} lays the pattern, works out the coverage and runs every check.</li>
 * </ul>
 * Both answer FEATURE_NOT_READY while shift planning is not switched on (V143.106 missing, or the planner scope
 * or baseline schedule not built yet).
 */
@RestController
@RequestMapping("/v1/rosters")
@Tag(name = "Shift planner", description = "People to plan and the roster's live preview")
@SecurityRequirement(name = "bearerAuth")
public class RosterPlanningController {

    private final ObjectProvider<PlannerScope> scope;
    private final PlanFactsLoader facts;
    private final PlannerPeople people;

    public RosterPlanningController(ObjectProvider<PlannerScope> scope, PlanFactsLoader facts, PlannerPeople people) {
        this.scope = scope;
        this.facts = facts;
        this.people = people;
    }

    @Operation(summary = "People a roster can plan, with the published rosters already planning them in the period")
    @GetMapping("/people")
    @PreAuthorize("hasAuthority('attendance.roster.plan')")
    public List<PlannerPerson> people(@AuthenticationPrincipal Jwt jwt,
                                      @RequestParam("companyId") UUID companyId,
                                      @RequestParam(value = "departmentId", required = false) UUID departmentId,
                                      @RequestParam(value = "branchId", required = false) UUID branchId,
                                      @RequestParam("from") LocalDate from,
                                      @RequestParam("to") LocalDate to) {
        RosterPlanner.requireValidRange(from, to);
        PlannerScope planners = scope();
        Actor actor = planners.actor(jwt, companyId);
        Set<UUID> departments = null;
        if (!actor.companyWide()) {
            if (departmentId != null) planners.check(actor, departmentId, List.of());
            departments = actor.headedDepartmentIds() == null ? Set.of() : actor.headedDepartmentIds();
        }
        return people.list(TenantContext.requireTenantId(), companyId, departmentId, branchId, departments, from, to);
    }

    @Operation(summary = "The live preview: generate, coverage and checks for a roster as it is being planned (saves nothing)")
    @PostMapping("/preview")
    @PreAuthorize("hasAuthority('attendance.roster.plan')")
    public PlanResponse preview(@AuthenticationPrincipal Jwt jwt,
                                @RequestParam("companyId") UUID companyId,
                                @RequestBody PlanRequest body) {
        RosterPlanner.requireValidRange(body.startDate(), body.endDate());
        PlannerScope planners = scope();
        Actor actor = planners.actor(jwt, companyId);
        // A department planner previews only rosters of a department they head; people outside it come back as E5.
        if (!actor.companyWide()) planners.check(actor, body.departmentId(), List.of());
        Set<UUID> ids = new LinkedHashSet<>();
        if (body.members() != null) for (MemberIn m : body.members()) if (m != null && m.employeeId() != null) ids.add(m.employeeId());
        PlanFacts loaded = facts.load(TenantContext.requireTenantId(), companyId, body.rosterId(), new ArrayList<>(ids),
                body.startDate().minusDays(1), body.endDate());
        return RosterPlanner.plan(body, loaded.withPlanner(actor));
    }

    /** The planner scope (package A); FEATURE_NOT_READY on a build that does not have it yet. */
    private PlannerScope scope() {
        PlannerScope s = scope.getIfAvailable();
        if (s == null) throw new FeatureNotReady();
        return s;
    }
}
