package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract;

/**
 * Generate, coverage and checks in one pure function: no Spring, no database (design §1.3, §1.4).
 * The live preview, save, check, publish and the import all call it, so the web never
 * re-implements a planning rule. Package B fills it in.
 */
public final class RosterPlanner {

    private RosterPlanner() {}

    public static RosterContract.PlanResponse plan(RosterContract.PlanRequest in, PlanFacts facts) {
        throw new UnsupportedOperationException("RosterPlanner is not built yet (shift planning package B)");
    }
}
