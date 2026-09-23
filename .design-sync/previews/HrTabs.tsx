import { HrTabs } from '@unifiedtree/design-sync-entry'
import type { HrTab } from '@unifiedtree/design-sync-entry'

// The Salary Advances strip (Advance.tsx shape) with badge counts: the
// selected tab's badge turns emerald, the rest stay grey.
export function WithBadges() {
  const tabs: HrTab[] = [
    { key: 'company', label: 'Company Advances', badge: 128 },
    { key: 'my', label: 'My Advances', badge: 3 },
    { key: 'request', label: 'Request Advance' },
    { key: 'approvals', label: 'Approvals', badge: 14 },
  ]
  return <HrTabs tabs={tabs} active="company" onChange={() => {}} />
}

// Plain labels, a middle tab selected (Attendance.tsx shape).
export function Plain() {
  const tabs: HrTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'muster', label: 'Muster Roll' },
    { key: 'shifts', label: 'Shifts & OT' },
    { key: 'regularisation', label: 'Regularisation' },
    { key: 'geofence', label: 'Geofence' },
  ]
  return <HrTabs tabs={tabs} active="muster" onChange={() => {}} />
}

// The employee workspace strip: eight tabs — the widest strip that still fits a 900px card (it scrolls horizontally
// when it overflows instead of wrapping).
export function ManyTabs() {
  const tabs: HrTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'personal', label: 'Personal' },
    { key: 'job', label: 'Job' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'documents', label: 'Documents', badge: 6 },
    { key: 'leave', label: 'Leave' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'performance', label: 'Performance' },
  ]
  return <HrTabs tabs={tabs} active="payroll" onChange={() => {}} />
}
