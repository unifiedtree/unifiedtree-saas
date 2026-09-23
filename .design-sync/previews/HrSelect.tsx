import { HrSelect } from '@unifiedtree/design-sync-entry'
import type { HrSelectOption } from '@unifiedtree/design-sync-entry'

const heads: HrSelectOption[] = [
  { value: '', label: 'None' },
  { value: 'e142', label: 'Priya Raghavan · EMP-0142' },
  { value: 'e087', label: 'Arjun Mehta · EMP-0087' },
  { value: 'e211', label: 'Sneha Kulkarni · EMP-0211' },
  { value: 'e056', label: 'Rohan Das · EMP-0056' },
]

const categories: HrSelectOption[] = [
  { value: 'EARNING', label: 'Earning' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement' },
  { value: 'STATUTORY', label: 'Statutory' },
]

const periods: HrSelectOption[] = [
  { value: 'sep-2026', label: 'September 2026' },
  { value: 'aug-2026', label: 'August 2026' },
  { value: 'jul-2026', label: 'July 2026' },
]

// The department-head picker from Org Setup (OrgSetup.tsx shape): options
// labelled "Name · EMP-code", one selected. The listbox itself only opens on
// click, so the closed state is what's shown.
export function DepartmentHead() {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-500">Department head</p>
      <HrSelect value="e087" onChange={() => {}} options={heads} />
    </div>
  )
}

// No option matches the value, so the placeholder shows in tertiary text.
export function Placeholder() {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-500">Category</p>
      <HrSelect value="" onChange={() => {}} options={categories} placeholder="Select a category…" />
    </div>
  )
}

// sm (34px, 13px text) is the filter-bar height; md (40px, 14px text)
// matches the form inputs. Bottom-aligned so the height delta is visible.
export function Sizes() {
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <p className="mb-2 text-xs font-semibold text-gray-500">sm · filter bars</p>
        <HrSelect size="sm" value="sep-2026" onChange={() => {}} options={periods} />
      </div>
      <div className="flex-1">
        <p className="mb-2 text-xs font-semibold text-gray-500">md · forms</p>
        <HrSelect size="md" value="sep-2026" onChange={() => {}} options={periods} />
      </div>
    </div>
  )
}

// disabled keeps the selected label but the trigger no longer opens.
export function Disabled() {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-500">Computation</p>
      <HrSelect value="STATUTORY" onChange={() => {}} options={categories} disabled />
    </div>
  )
}
