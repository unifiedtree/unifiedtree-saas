/**
 * Shift planning, Phase 1 — the frozen API contract (design §1.5).
 *
 * Mirrors `backend/app/hrms-api/src/main/java/com/hrms/api/roster/RosterContract.java` one to one.
 * A change here is a change there, made on `shift/p1-contract` only; nobody edits these types on a
 * package branch.
 */

export type ISODate = string                     // 'YYYY-MM-DD' (India dates)
export type CellToken = string | null            // a shiftPolicyId | 'WO' | null (empty)
export type WeeklyOffMode = 'FIXED' | 'ROTATIONAL' | 'CUSTOM'      // pending 4; default 'ROTATIONAL'
export type StaggerMode = 'SPREAD' | 'SAME' | 'CONTINUE'           // default 'SPREAD'
export interface PatternDay { shiftPolicyId: string | null; weeklyOff: boolean }

export interface RotationTemplate { id: string; companyId: string; departmentId: string | null; name: string; repeats: boolean;
  days: PatternDay[]; updatedByName: string | null; updatedAt: string; editable: boolean }
export interface TemplateBody { name: string; departmentId?: string | null; repeats: boolean; days: PatternDay[] }   // 1..62 days

export interface RosterConfig { templateId: string | null; pattern: PatternDay[]; repeats: boolean;
  weeklyOffMode: WeeklyOffMode; staggerMode: StaggerMode; continueFromRosterId: string | null;
  shiftIds: string[];               // shifts ticked in step 2 (preview/coverage columns)
  designationIds: string[] }        // ticked in step 5; '' = the "No designation" bucket

export interface MemberIn { employeeId: string; rotationOffset: number }                // display order = array order
export interface StaffingIn { designationId: string; shiftPolicyId: string; required: number }
export interface RowIn { employeeId: string; cells: CellToken[]; edited: number[] }   // cells[i] = startDate + i days

export interface DraftBody { name: string; periodType: 'MONTH' | 'RANGE'; startDate: ISODate; endDate: ISODate;
  departmentId: string | null; branchId: string | null; config: RosterConfig;
  members: MemberIn[]; staffing: StaffingIn[]; rows: RowIn[]; lockVersion?: number }   // lockVersion required on PUT

export interface RosterSummary { id: string; companyId: string; name: string; periodType: 'MONTH' | 'RANGE';
  startDate: ISODate; endDate: ISODate; departmentId: string | null; departmentName: string | null;
  branchId: string | null; branchName: string | null; status: 'DRAFT' | 'PUBLISHED'; source: 'PLANNER' | 'IMPORT';
  hasUnpublishedChanges: boolean; version: number; memberCount: number;
  publishedByName: string | null; publishedAt: string | null; updatedByName: string | null; updatedAt: string;
  canEdit: boolean; canPublish: boolean }
export interface RosterDetail { roster: RosterSummary & { lockVersion: number; config: RosterConfig };
  members: MemberIn[]; staffing: StaffingIn[]; rows: RowIn[]; plan: PlanResponse }

export interface PlanRequest { startDate: ISODate; endDate: ISODate; departmentId: string | null; branchId: string | null;
  rosterId: string | null;          // the roster being edited (its own published days are not "another roster", E3)
  config: RosterConfig; members: MemberIn[]; staffing: StaffingIn[]; rows: RowIn[];
  regenerate: boolean;              // true: lay the pattern again (and spread offsets for members with none)
  keepEdits: boolean }              // with regenerate: keep cells listed in RowIn.edited
export interface PlanResponse { days: { date: ISODate; weekday: number /* ISO 1..7 */; holidayName: string | null }[];
  rows: PlanRow[]; coverage: CoverageRow[]; checks: Checks; members: MemberIn[] /* offsets as used */ }
export interface PlanRow { employeeId: string; employeeName: string; employeeCode: string | null;
  designationId: string | null; designationName: string | null; departmentName: string | null; branchName: string | null;
  rotationOffset: number; cells: PlanCell[];
  totals: { working: number; weeklyOff: number; holiday: number; leave: number; unplanned: number } }
export interface PlanCell { token: CellToken; code: string | null /* 'A', 'WO', or null */; edited: boolean;
  overlay: null | { type: 'PH' | 'L' | 'COFF'; label: string; halfDay: boolean };
  outside: boolean /* before joining or after the last working day */; issueIds: string[] }
export interface CoverageRow { shiftPolicyId: string; code: string | null; designationId: string | null /* null = all */;
  perDay: { required: number | null; scheduled: number; status: 'OK' | 'SHORT' | 'OVER' | 'NONE' | 'HOLIDAY' }[] }
export interface Issue { key: string /* unique in the response */; id: 'E1'|'E2'|'E3'|'E4'|'E5'|'W1'|'W2'|'W3'|'W4'|'W5'|'W6'|'W7'|'I1'|'I2';
  level: 'error' | 'warning' | 'info'; employeeId: string | null; dates: ISODate[];
  shiftPolicyId: string | null; designationId: string | null; message: string }
export interface Checks { errors: Issue[]; warnings: Issue[]; infos: Issue[];
  summary: { id: Issue['id']; level: Issue['level']; count: number; label: string }[] }   // "✓ All employees assigned" lines

export interface PublishBody { lockVersion: number; acknowledgeWarnings: boolean; note?: string }   // note ≤ 500
export interface PublishResult { roster: RosterSummary; version: number; daysAdded: number; daysChanged: number;
  daysRemoved: number; peopleToNotify: number }

export interface PlannerPerson { employeeId: string; name: string; code: string | null;
  designationId: string | null; designationName: string | null; departmentId: string | null; departmentName: string | null;
  branchId: string | null; branchName: string | null; joinedOn: ISODate | null; lastWorkingDay: ISODate | null;
  otherRosters: { rosterId: string; name: string; startDate: ISODate; endDate: ISODate }[] }

export interface ScheduleDay { employeeId: string; employeeName?: string; date: ISODate; kind: 'SHIFT' | 'WO' | 'NONE';
  shiftPolicyId: string | null; code: string | null; shiftName: string | null; startTime: string | null; endTime: string | null;
  nightShift: boolean; source: 'ROSTER' | 'BASELINE'; rosterId: string | null; rosterName: string | null;
  overlay: null | { type: 'PH' | 'L' | 'COFF'; label: string; halfDay: boolean } }
export interface ScheduleChange { id: string; employeeId: string; employeeName: string; date: ISODate; change: 'ADDED' | 'CHANGED' | 'REMOVED';
  oldCode: string | null; newCode: string | null; source: 'ROSTER' | 'IMPORT' | 'SWAP' | 'SHIFT_CHANGE';
  rosterVersion: number; changedByName: string | null; changedAt: string; note: string | null }
export interface RosterSettings { companyId: string; minRestMinutes: number; rostersDriveAttendance: boolean;
  updatedByName: string | null; updatedAt: string | null }

export interface ImportValidation { startDate: ISODate; endDate: ISODate; sheetName: string; headerRow: number;
  rows: { rowNo: number; sheetEmployee: string; sheetCode: string | null; employeeId: string | null;
          matchedBy: 'CODE' | 'NAME' | null; codes: (string | null)[] /* raw, aligned to the period */ }[];
  problems: { rowNo: number | null; column: string | null; date: ISODate | null; code: string;
              severity: 'error' | 'warning' | 'info'; message: string }[];
  summary: { rows: number; matched: number; errors: number; warnings: number };
  plan: PlanResponse | null }      // the preview; null when nothing could be matched

// ── Inline bodies of the endpoint table (design §1.5), named here so hooks share one type ──
/** `GET /v1/schedule/me` */
export interface MySchedule { employeeId: string; days: ScheduleDay[] }
/** `PUT /v1/rosters/settings` */
export interface RosterSettingsBody { minRestMinutes: number }
/** `POST /v1/rosters/{id}/discard-changes` */
export interface LockVersionBody { lockVersion: number }

/** The weekly-off cell token. */
export const WO_TOKEN = 'WO'
