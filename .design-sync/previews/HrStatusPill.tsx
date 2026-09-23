import { HrStatusPill } from '@unifiedtree/design-sync-entry'
import type { PillTone } from '@unifiedtree/design-sync-entry'

// Every tone, labelled the way the HRMS screens actually use it.
export function AllTones() {
  const tones: Array<[PillTone, string]> = [
    ['ok', 'Approved'],
    ['green', 'Present'],
    ['warn', 'Pending'],
    ['orange', 'Half day'],
    ['late', 'Late'],
    ['info', 'In review'],
    ['blue', 'Scheduled'],
    ['teal', 'Work from home'],
    ['purple', 'On leave'],
    ['pink', 'Probation'],
    ['red', 'Rejected'],
    ['gray', 'Draft'],
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {tones.map(([tone, label]) => (
        <HrStatusPill key={tone} tone={tone}>{label}</HrStatusPill>
      ))}
    </div>
  )
}

// Attendance day statuses as the muster roll and dashboard render them.
export function AttendanceStatuses() {
  return (
    <div className="flex flex-wrap gap-2">
      <HrStatusPill tone="ok">Present</HrStatusPill>
      <HrStatusPill tone="late">Late</HrStatusPill>
      <HrStatusPill tone="orange">Half day</HrStatusPill>
      <HrStatusPill tone="teal">WFH</HrStatusPill>
      <HrStatusPill tone="purple">On leave</HrStatusPill>
      <HrStatusPill tone="red">Absent</HrStatusPill>
      <HrStatusPill tone="gray">Weekly off</HrStatusPill>
    </div>
  )
}

// Advance / expense request lifecycle, one pill per state.
export function RequestLifecycle() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <HrStatusPill tone="warn">Pending approval</HrStatusPill>
      <span className="text-xs text-gray-400">→</span>
      <HrStatusPill tone="ok">Approved</HrStatusPill>
      <span className="text-xs text-gray-400">→</span>
      <HrStatusPill tone="info">Disbursed</HrStatusPill>
      <span className="text-xs text-gray-400">→</span>
      <HrStatusPill tone="gray">Closed</HrStatusPill>
      <span className="mx-2 text-xs text-gray-400">or</span>
      <HrStatusPill tone="red">Rejected</HrStatusPill>
    </div>
  )
}
