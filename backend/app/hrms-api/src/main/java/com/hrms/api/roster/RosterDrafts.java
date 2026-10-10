package com.hrms.api.roster;

import java.util.UUID;

/**
 * Saving a draft roster, as the Excel import (package C) uses it. Implemented by package A; the
 * same rules as {@code POST /v1/rosters} and {@code PUT /v1/rosters/{id}} (design §1.5 "Save").
 */
public interface RosterDrafts {

    /** Source of a roster created by the planner. */
    String SOURCE_PLANNER = "PLANNER";
    /** Source of a roster created by the Excel import. */
    String SOURCE_IMPORT = "IMPORT";

    /** Creates a DRAFT; {@code source} is {@link #SOURCE_PLANNER} or {@link #SOURCE_IMPORT}. */
    RosterContract.RosterDetail create(UUID companyId, RosterContract.DraftBody body, Actor a, String source);

    /** Replaces the members, staffing, config and cells of a roster ({@code body.lockVersion} must match). */
    RosterContract.RosterDetail replace(UUID rosterId, RosterContract.DraftBody body, Actor a);
}
