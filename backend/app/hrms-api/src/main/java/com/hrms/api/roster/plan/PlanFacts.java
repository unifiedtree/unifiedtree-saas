package com.hrms.api.roster.plan;

/**
 * Everything {@link RosterPlanner} needs from the database for one plan: the company's active shifts,
 * the people (designation, department, branch, joining, last working day), their baseline days,
 * holidays, approved leave, other rosters' schedule days and the minimum rest (design §1.3).
 *
 * <p>Package B's internal shape: the store (A) and the import (C) only pass it from
 * {@link PlanFactsLoader#load} to {@link RosterPlanner#plan}, so B adds its fields freely.
 */
public record PlanFacts() {}
