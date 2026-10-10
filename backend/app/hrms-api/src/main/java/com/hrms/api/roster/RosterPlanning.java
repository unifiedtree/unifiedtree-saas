package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.api.roster.plan.PlanFactsLoader;
import com.hrms.api.roster.plan.RosterPlanner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * How the store calls the planner (package B, design §1.5 "Java seams"): {@link PlanFactsLoader#load}
 * then {@link RosterPlanner#plan}, for the {@code plan} of a saved roster, the full check and the
 * publish. The web never re-implements a planning rule, and neither does this package.
 *
 * <p>While package B is not part of the build (its loader bean is missing, or {@code plan} still
 * refuses as the contract stub), the answer is empty: a roster's {@code plan} is null, the check
 * answers FEATURE_NOT_READY, and a publish keeps only the store's own guards (scope, lock, past days,
 * another roster's days, the person's company). Said once in the log. Any other failure of the
 * planner is a real fault and is thrown as it is.
 */
@Component
public class RosterPlanning {

    private static final Logger log = LoggerFactory.getLogger(RosterPlanning.class);

    private final ObjectProvider<PlanFactsLoader> loader;
    private final AtomicBoolean warned = new AtomicBoolean();

    public RosterPlanning(ObjectProvider<PlanFactsLoader> loader) {
        this.loader = loader;
    }

    /**
     * Generate + coverage + checks for {@code in}, as {@code actor} plans it (a department planner gets check E5
     * for anyone outside the departments they head); empty while the planner is not in the build.
     */
    public Optional<PlanResponse> plan(UUID tenantId, UUID companyId, PlanRequest in, Actor actor) {
        PlanFactsLoader l = loader.getIfAvailable();
        if (l == null) return notBuilt("no PlanFactsLoader bean");
        java.util.List<UUID> people = in.members() == null ? java.util.List.of()
                : in.members().stream().map(RosterContract.MemberIn::employeeId).toList();
        try {
            PlanFacts facts = l.load(tenantId, companyId, in.rosterId(), people, in.startDate().minusDays(1), in.endDate());
            return Optional.ofNullable(RosterPlanner.plan(in, facts == null ? null : facts.withPlanner(actor)));
        } catch (UnsupportedOperationException stub) {
            return notBuilt(stub.getMessage());
        }
    }

    private Optional<PlanResponse> notBuilt(String why) {
        if (warned.compareAndSet(false, true)) {
            log.warn("Shift planner (package B) is not in this build ({}): rosters have no plan or checks; publish keeps the store's own guards only", why);
        }
        return Optional.empty();
    }
}
