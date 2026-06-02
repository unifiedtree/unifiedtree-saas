# Payroll — Loss of Pay (LOP) Rules

This is the **rule of record** for how Loss of Pay is computed. The pure
`LopCalculator` (`backend/modules/hrms-payroll/.../lop/LopCalculator.java`)
encodes these rules; `LopCalculatorTest` has one test per case below. The
payroll engine (Prompt 13) will feed `LopCalculator` day-statuses derived from
attendance + leave — this document defines the decisions, not the plumbing.

**Invariant:** `paidDays + lopDays == totalCalendar` for every employee, every period.

**Day status vocabulary** (`LopCalculator.DayStatus`):
`PRESENT, PAID_LEAVE, LOP_LEAVE, HOLIDAY, WEEKEND, UNAUTHORIZED_ABSENT, HALF_DAY_LEAVE`.

Source tables the engine reads to derive statuses (read-only — payroll never writes them):
- Attendance: `attendance.records` (`attendance_date`, `attendance_status`).
- Leave: `leave_mgmt.leave_requests` (`status='APPROVED'`, `start_date`, `end_date`, `half_day`, `half_day_part`), `leave_mgmt.leave_types` (`code`, `is_paid_leave` — a type with `is_paid_leave=false` is an LOP leave type).
- Holidays: `settings.holiday_calendar` (`holiday_date`, `is_active`) and/or `leave_mgmt.holiday_calendars` (`holiday_date`, `is_optional`).
- Shift / working-day: `attendance.shift_policies` + `attendance.employee_shift_assignments` (which days are expected working days).

Tenant config that drives LOP (`payroll.settings`): `sandwich_rule_enabled`, `late_mark_lop_threshold`.

---

## CASE 1 — Half-day leave
**Q:** Employee takes a half-day paid leave on the 15th, present otherwise. Does LOP apply?
**Decision:** No LOP. A half-day **paid** leave is fully paid; the 0.5 comes off the leave balance, not pay. Only `HALF_DAY_LEAVE` (an unpaid/LOP half) splits pay 0.5/0.5. In `LopCalculator`, `HALF_DAY_LEAVE` → 0.5 paid + 0.5 lop; a half-day *paid* leave day is modelled as `PAID_LEAVE` (1.0 paid).
**Confirmed:** Product default.

## CASE 2 — Unauthorized absence (no leave, no punch)
**Q:** Employee doesn't show up on the 12th, no leave application.
**Decision:** LOP. `UNAUTHORIZED_ABSENT` → 1.0 lop. Reason logged as `UNAUTHORIZED_ABSENT` in `computation_log`.

## CASE 3 — Sandwich rule
**Q:** Leave Friday + Monday; the Sat/Sun in between — paid?
**Decision:** **Tenant-configurable** via `payroll.settings.sandwich_rule_enabled` (default **false** → weekend paid). When enabled, a maximal run of `WEEKEND`/`HOLIDAY` days bracketed by LOP on **both** adjacent sides converts to LOP. `LopCalculator` implements exactly this bracketing.

## CASE 4 — Holiday during leave
**Q:** Leave Mon+Tue+Wed; Tue is a public holiday.
**Decision:** Tue is **paid** (holiday); the employee burns 2 leave days, not 3. This is `leave_mgmt`'s job (it already excludes holidays from leave-day counting using `settings.holiday_calendar.holiday_date` / `leave_mgmt.holiday_calendars.holiday_date`). For LOP, a `HOLIDAY` day is always paid (1.0) unless the sandwich rule converts it (Case 3).

## CASE 5 — Late-mark accumulation
**Q:** 3 late-marks in a month = 1 LOP day?
**Decision:** **Tenant-configurable** via `payroll.settings.late_mark_lop_threshold` (NULL/0 = disabled). When set to N, `floor(lateMarkCount / N)` LOP days are moved from paid to lop. Late counts come from `attendance.records.late_by_minutes`.

## CASE 6 — Alternate-Saturday companies
**Q:** 2nd & 4th Saturday off; employee absent on a *working* 1st Saturday.
**Decision:** The 1st Saturday is a working day → absence is LOP. There is **no** alternate-Saturday column in `attendance.shift_policies`; the working-calendar pattern is policy-driven config the engine resolves (via shift assignment + a working-calendar). A working day flagged absent is `UNAUTHORIZED_ABSENT` or `LOP_LEAVE`; a genuine week-off Saturday is `WEEKEND` (paid).

## CASE 7 — Joiner mid-month
**Q:** Joins on the 15th, CTC 30k/month. Salary for that month?
**Decision:** Pro-rated. Calendar days **before** `joinDate` are LOP (not employed). `LopCalculator` marks any day whose date `isBefore(joinDate)` as LOP. Per-component pro-ration (BASIC, HRA scaling by `paidDays/totalCalendar`) is the engine's job in Prompt 13.

## CASE 8 — Exit mid-month
**Q:** Resigns, last working day the 20th.
**Decision:** Pro-rated. Calendar days **after** `exitDate` are LOP. `LopCalculator` marks any day `isAfter(exitDate)` as LOP. PF/ESI compute on the pro-rated wage (Prompt 13).

## CASE 9 — Notice-period buyout
**Q:** Leaves without serving notice; company recovers from final salary.
**Decision:** **Out of scope for LOP.** This is a one-time **recovery deduction** component, not LOP. Do not conflate — `LopCalculator` does not handle it.

## CASE 10 — LOP applied as a leave type
**Q:** Employee explicitly applies for an "LOP" leave type.
**Decision:** Same pay effect as unauthorized absence, but tracked as a leave decision. Identified by `leave_mgmt.leave_types.is_paid_leave = false` (or a tenant `code = 'LOP'`). The engine maps such approved leave days to `LOP_LEAVE` → 1.0 lop.

---

### LopCalculator contract
```
LopResult calculate(LopInput in)

LopInput(List<DayStatus> days, boolean sandwichRuleEnabled, int lateMarkLopThreshold,
         int lateMarkCount, LocalDate joinDate, LocalDate exitDate, YearMonth period)
LopResult(BigDecimal paidDays, BigDecimal lopDays, int totalCalendar, List<DayBreakdown> log)
```
`days.size()` must equal `period.lengthOfMonth()` (== `totalCalendar`). `log` populates the `payroll.run_lop_days.computation_log` JSONB so every LOP figure is auditable day-by-day.

---

## Payroll Engine (Prompt 13a)

`com.hrms.payroll.engine.PayrollEngine.compute(PayrollEngineInput)` is a **pure**
function (no Spring/DB) that turns the structure + `LopResult` + tenant statutory
config into payslip lines and gross/deductions/net totals. Rounding is **HALF_UP
to 2 decimals at the line level**.

1. **Earnings** are pro-rated by `paidDays / totalCalendar`.
2. **PF** (only when enabled + employee PF-applicable + `pfStatus = ENROLLED`):
   base = pro-rated BASIC, capped at the **flat** wage ceiling (₹15,000 — the
   ceiling is *not* pro-rated); employee + employer each `base × percent`.
3. **ESI** eligibility is decided on the **full** monthly gross vs the ceiling
   (₹21,000): above it → no ESI lines; otherwise both sides charge the
   **pro-rated** gross.
4. **PT** is the flat slab amount (looked up by full gross) — never pro-rated.
5. **Net** = gross − employee-side deductions. Employer contributions are
   persisted for reporting but excluded from net.
6. **Negative net** is allowed and flagged as a warning, never clamped.

### Attendance defaulting is exception-based

The run service (`PayrollRunService.buildDayStatuses`) resolves each calendar day
from attendance → approved leave → holiday → weekend, and **a working day with no
record and no leave defaults to PRESENT (paid)**. This matches how Indian SMEs run
payroll: pay is full unless an absence / unpaid leave is explicitly marked. Marked
`ABSENT` and unpaid approved leave still produce LOP. Mid-month join/exit pro-rate
via `LopInput.joinDate / exitDate`; a missing `date_of_joining` is treated as
"joined before the period" so active employees are never silently dropped.

### Run lifecycle (13a)

`DRAFT → (process) → PROCESSING → (lock) → LOCKED`. **LOCKED is terminal** in this
phase — `reopen` returns `422 CANNOT_REOPEN_LOCKED`. Period = full calendar month.
Payslip PDFs are generated on demand (reusing the Letters `PdfRenderer`); nothing
is cached. PAID/CANCELLED and TDS/statutory reports are reserved for 13b.
