package com.hrms.api.roster;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The frozen JSON contract of shift planning, Phase 1: every request and response body of the
 * planner, roster, schedule and import endpoints. It mirrors
 * {@code apps/platform/src/modules/hrms/api/rosterTypes.ts} one to one (same names, same nesting);
 * a change here is a change there, made on {@code shift/p1-contract} only (design §3.2).
 *
 * <p>Conventions: dates are India dates ({@link LocalDate}, {@code 'YYYY-MM-DD'}); timestamps are
 * {@link Instant}; ids are {@link UUID}. A {@code CellToken} is a {@code String}: a shift policy id,
 * {@code "WO"}, or {@code null} for an empty cell. Union string types are enums whose constant names
 * are the JSON values. Times of day ({@code startTime}, {@code endTime}) are {@code "HH:mm"} strings.
 */
public final class RosterContract {

    private RosterContract() {}

    /** The weekly-off token in a cell ({@code CellToken}). */
    public static final String WO = "WO";

    // ── enums (TS string unions) ────────────────────────────────────────────

    /** How weekly offs are laid (pending-owner default 4); default ROTATIONAL. */
    public enum WeeklyOffMode { FIXED, ROTATIONAL, CUSTOM }

    /** How members' start days in the pattern are chosen; default SPREAD. */
    public enum StaggerMode { SPREAD, SAME, CONTINUE }

    public enum PeriodType { MONTH, RANGE }

    public enum RosterStatus { DRAFT, PUBLISHED }

    public enum RosterSource { PLANNER, IMPORT }

    /** PH = holiday, L = approved leave, COFF = approved leave of a COMPENSATORY type. */
    public enum OverlayType { PH, L, COFF }

    public enum CoverageStatus { OK, SHORT, OVER, NONE, HOLIDAY }

    /** Check ids of design §1.4: E = error (blocks publish), W = warning, I = info. */
    public enum IssueId { E1, E2, E3, E4, E5, W1, W2, W3, W4, W5, W6, W7, I1, I2 }

    /** Lower case on purpose: the JSON values are {@code 'error' | 'warning' | 'info'}. */
    public enum Level { error, warning, info }

    public enum ScheduleKind { SHIFT, WO, NONE }

    /** Where a {@link ScheduleDay} came from: a published roster day, or today's rule. */
    public enum ScheduleDaySource { ROSTER, BASELINE }

    public enum ChangeKind { ADDED, CHANGED, REMOVED }

    /** What wrote a schedule day; Phase 1 writes ROSTER or IMPORT. */
    public enum ChangeSource { ROSTER, IMPORT, SWAP, SHIFT_CHANGE }

    public enum MatchedBy { CODE, NAME }

    // ── rotation patterns ───────────────────────────────────────────────────

    /** One day of a pattern: a shift, or a weekly off ({@code shiftPolicyId} null). */
    public record PatternDay(UUID shiftPolicyId, boolean weeklyOff) {}

    public record RotationTemplate(UUID id, UUID companyId, UUID departmentId, String name, boolean repeats,
                                   List<PatternDay> days, String updatedByName, Instant updatedAt,
                                   boolean editable) {}

    /** Create / replace a pattern; 1..62 days. */
    public record TemplateBody(String name, UUID departmentId, boolean repeats, List<PatternDay> days) {}

    // ── roster bodies ───────────────────────────────────────────────────────

    /**
     * The wizard's choices, stored on the roster so it reopens as left.
     * {@code designationIds}: ticked designations; {@code ""} = the "No designation" bucket, so
     * these are strings, not UUIDs.
     */
    public record RosterConfig(UUID templateId, List<PatternDay> pattern, boolean repeats,
                               WeeklyOffMode weeklyOffMode, StaggerMode staggerMode,
                               UUID continueFromRosterId, List<UUID> shiftIds, List<String> designationIds) {}

    /** A member; display order = array order. */
    public record MemberIn(UUID employeeId, int rotationOffset) {}

    public record StaffingIn(UUID designationId, UUID shiftPolicyId, int required) {}

    /** {@code cells[i]} is the token for {@code startDate + i} days; {@code edited} lists edited indexes. */
    public record RowIn(UUID employeeId, List<String> cells, List<Integer> edited) {}

    /** Create (POST) or replace (PUT) a draft; {@code lockVersion} is required on PUT. */
    public record DraftBody(String name, PeriodType periodType, LocalDate startDate, LocalDate endDate,
                            UUID departmentId, UUID branchId, RosterConfig config,
                            List<MemberIn> members, List<StaffingIn> staffing, List<RowIn> rows,
                            Integer lockVersion) {}

    // ── roster responses ────────────────────────────────────────────────────

    public record RosterSummary(UUID id, UUID companyId, String name, PeriodType periodType,
                                LocalDate startDate, LocalDate endDate,
                                UUID departmentId, String departmentName, UUID branchId, String branchName,
                                RosterStatus status, RosterSource source, boolean hasUnpublishedChanges,
                                int version, int memberCount, String publishedByName, Instant publishedAt,
                                String updatedByName, Instant updatedAt, boolean canEdit, boolean canPublish) {}

    /**
     * {@code RosterDetail.roster} = {@code RosterSummary & { lockVersion; config }} in the TS file: the
     * same fields as {@link RosterSummary}, flat, plus the two.
     */
    public record RosterHeader(UUID id, UUID companyId, String name, PeriodType periodType,
                               LocalDate startDate, LocalDate endDate,
                               UUID departmentId, String departmentName, UUID branchId, String branchName,
                               RosterStatus status, RosterSource source, boolean hasUnpublishedChanges,
                               int version, int memberCount, String publishedByName, Instant publishedAt,
                               String updatedByName, Instant updatedAt, boolean canEdit, boolean canPublish,
                               int lockVersion, RosterConfig config) {}

    public record RosterDetail(RosterHeader roster, List<MemberIn> members, List<StaffingIn> staffing,
                               List<RowIn> rows, PlanResponse plan) {}

    // ── plan (generate + coverage + checks) ─────────────────────────────────

    /**
     * The stateless preview's input. {@code rosterId}: the roster being edited (its own published days
     * are not "another roster", E3). {@code regenerate}: lay the pattern again (and spread offsets for
     * members with none); {@code keepEdits}: with regenerate, keep the cells listed in {@code RowIn.edited}.
     */
    public record PlanRequest(LocalDate startDate, LocalDate endDate, UUID departmentId, UUID branchId,
                              UUID rosterId, RosterConfig config, List<MemberIn> members,
                              List<StaffingIn> staffing, List<RowIn> rows, boolean regenerate,
                              boolean keepEdits) {}

    /** {@code weekday}: ISO 1 (Monday) .. 7 (Sunday). */
    public record PlanDay(LocalDate date, int weekday, String holidayName) {}

    /** {@code members}: the offsets as used. */
    public record PlanResponse(List<PlanDay> days, List<PlanRow> rows, List<CoverageRow> coverage,
                               Checks checks, List<MemberIn> members) {}

    /** The S13 totals of a row. */
    public record RowTotals(int working, int weeklyOff, int holiday, int leave, int unplanned) {}

    public record PlanRow(UUID employeeId, String employeeName, String employeeCode,
                          UUID designationId, String designationName, String departmentName, String branchName,
                          int rotationOffset, List<PlanCell> cells, RowTotals totals) {}

    public record Overlay(OverlayType type, String label, boolean halfDay) {}

    /**
     * {@code code}: {@code 'A'}, {@code 'WO'} or null. {@code overlay}: null when none.
     * {@code outside}: before joining or after the last working day.
     */
    public record PlanCell(String token, String code, boolean edited, Overlay overlay, boolean outside,
                           List<String> issueIds) {}

    /** {@code required}: null = no requirement. */
    public record CoverageDay(Integer required, int scheduled, CoverageStatus status) {}

    /** {@code designationId}: null = all designations together. */
    public record CoverageRow(UUID shiftPolicyId, String code, UUID designationId, List<CoverageDay> perDay) {}

    /** {@code key}: unique in the response (cells refer to it in {@code issueIds}). */
    public record Issue(String key, IssueId id, Level level, UUID employeeId, List<LocalDate> dates,
                        UUID shiftPolicyId, UUID designationId, String message) {}

    /** One "Schedule check" line ("✓ All employees assigned"). */
    public record CheckSummary(IssueId id, Level level, int count, String label) {}

    public record Checks(List<Issue> errors, List<Issue> warnings, List<Issue> infos,
                         List<CheckSummary> summary) {}

    // ── publish ─────────────────────────────────────────────────────────────

    /** {@code note}: optional, at most 500 characters. */
    public record PublishBody(int lockVersion, boolean acknowledgeWarnings, String note) {}

    public record PublishResult(RosterSummary roster, int version, int daysAdded, int daysChanged,
                                int daysRemoved, int peopleToNotify) {}

    // ── people in scope ─────────────────────────────────────────────────────

    public record OtherRoster(UUID rosterId, String name, LocalDate startDate, LocalDate endDate) {}

    public record PlannerPerson(UUID employeeId, String name, String code,
                                UUID designationId, String designationName, UUID departmentId,
                                String departmentName, UUID branchId, String branchName,
                                LocalDate joinedOn, LocalDate lastWorkingDay, List<OtherRoster> otherRosters) {}

    // ── effective schedule, history, settings ───────────────────────────────

    /**
     * One person-date of the effective schedule. {@code employeeName} is optional in the contract
     * ({@code employeeName?: string}): left out of the JSON when null (the "me" endpoint).
     */
    public record ScheduleDay(UUID employeeId,
                              @JsonInclude(JsonInclude.Include.NON_NULL) String employeeName,
                              LocalDate date, ScheduleKind kind, UUID shiftPolicyId, String code,
                              String shiftName, String startTime, String endTime, boolean nightShift,
                              ScheduleDaySource source, UUID rosterId, String rosterName, Overlay overlay) {}

    /** The body of {@code GET /v1/schedule/me}. */
    public record MySchedule(UUID employeeId, List<ScheduleDay> days) {}

    public record ScheduleChange(UUID id, UUID employeeId, String employeeName, LocalDate date, ChangeKind change,
                                 String oldCode, String newCode, ChangeSource source, int rosterVersion,
                                 String changedByName, Instant changedAt, String note) {}

    public record RosterSettings(UUID companyId, int minRestMinutes, boolean rostersDriveAttendance,
                                 String updatedByName, Instant updatedAt) {}

    /** The body of {@code PUT /v1/rosters/settings}. */
    public record RosterSettingsBody(int minRestMinutes) {}

    /** The body of {@code POST /v1/rosters/{id}/discard-changes}. */
    public record LockVersionBody(int lockVersion) {}

    // ── Excel import ────────────────────────────────────────────────────────

    /** {@code codes}: the raw codes, aligned to the period. */
    public record ImportRow(int rowNo, String sheetEmployee, String sheetCode, UUID employeeId,
                            MatchedBy matchedBy, List<String> codes) {}

    public record ImportProblem(Integer rowNo, String column, LocalDate date, String code, Level severity,
                                String message) {}

    public record ImportSummary(int rows, int matched, int errors, int warnings) {}

    /** {@code plan}: the preview; null when nothing could be matched. */
    public record ImportValidation(LocalDate startDate, LocalDate endDate, String sheetName, int headerRow,
                                   List<ImportRow> rows, List<ImportProblem> problems, ImportSummary summary,
                                   PlanResponse plan) {}
}
