import { HrButton, HrPageHeader, HrSelect, HrTabs } from '@unifiedtree/design-sync-entry'
import type { HrSelectOption, HrTab } from '@unifiedtree/design-sync-entry'
import { Download, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'

const advanceTabs: HrTab[] = [
  { key: 'company', label: 'Company Advances', badge: 128 },
  { key: 'my', label: 'My Advances', badge: 3 },
  { key: 'request', label: 'Request Advance' },
  { key: 'approvals', label: 'Approvals', badge: 14 },
]

const periods: HrSelectOption[] = [
  { value: 'sep-2026', label: 'September 2026' },
  { value: 'aug-2026', label: 'August 2026' },
  { value: 'jul-2026', label: 'July 2026' },
]

const departments: HrSelectOption[] = [
  { value: 'all', label: 'All departments' },
  { value: 'eng', label: 'Engineering' },
  { value: 'sales', label: 'Sales' },
  { value: 'fin', label: 'Finance' },
  { value: 'ops', label: 'Operations' },
]

// The Salary Advances screen (Advance.tsx shape): crumb, title, subtitle,
// toolbar actions on the right and the tab strip in the header's tabs slot.
export function WithActionsAndTabs() {
  return (
    <HrPageHeader
      crumb="Advance Management"
      title="Salary Advances"
      subtitle="Request, approve, and disburse employee salary advances"
      actions={
        <>
          <HrButton variant="ghost"><Download size={15} /> Export CSV</HrButton>
          <HrButton><Plus size={15} /> Request Advance</HrButton>
        </>
      }
      tabs={<HrTabs tabs={advanceTabs} active="company" onChange={() => {}} />}
    />
  )
}

// Crumb + title + subtitle only — the most common shape across the HRMS screens.
export function TitleAndSubtitle() {
  return (
    <HrPageHeader
      crumb="Employee exit"
      title="Full & final settlements"
      subtitle="Review a leaver's earnings and deductions, approve their settlement, and record completed payment."
    />
  )
}

// Register-style header (MusterRoll.tsx shape): a refresh action plus the
// period and department selects in the filters slot.
export function WithFilters() {
  return (
    <HrPageHeader
      crumb="Attendance & Time"
      title="Muster Roll"
      subtitle="Daily attendance register — every staff member's status and punch times for the selected day."
      actions={<HrButton variant="ghost"><RefreshCw size={16} /> Refresh</HrButton>}
      filters={
        <>
          <div style={{ width: 180 }}>
            <HrSelect size="sm" value="sep-2026" onChange={() => {}} options={periods} />
          </div>
          <div style={{ width: 180 }}>
            <HrSelect size="sm" value="all" onChange={() => {}} options={departments} />
          </div>
        </>
      }
    />
  )
}

// Both bottom slots at once: status tabs on the left, a department select
// and a filters toggle on the right.
export function TabsAndFilters() {
  const tabs: HrTab[] = [
    { key: 'active', label: 'Active', badge: 412 },
    { key: 'notice', label: 'On notice', badge: 9 },
    { key: 'exited', label: 'Exited', badge: 37 },
  ]
  return (
    <HrPageHeader
      crumb="Master"
      title="Workforce Directory"
      subtitle="Acme Industries Pvt Ltd · 458 employees"
      tabs={<HrTabs tabs={tabs} active="active" onChange={() => {}} />}
      filters={
        <>
          <div style={{ width: 180 }}>
            <HrSelect size="sm" value="eng" onChange={() => {}} options={departments} />
          </div>
          <HrButton size="sm" variant="ghost"><SlidersHorizontal size={14} /> Filters</HrButton>
        </>
      }
    />
  )
}
