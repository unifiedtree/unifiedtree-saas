import { FilterBar } from '@unifiedtree/design-sync-entry'
import type { FilterDef } from '@unifiedtree/design-sync-entry'

const noop = () => {}

const DEPARTMENTS = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
  { value: 'people-ops', label: 'People Ops' },
]
const STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
]

// The standard list-screen row: two selects, a free-text field and a date.
// `values` is the current state of each filter ('' = unfiltered).
function listFilters(values: Partial<Record<'department' | 'status' | 'code' | 'from', string>>): FilterDef[] {
  return [
    { key: 'department', allLabel: 'All Departments', value: values.department ?? '', options: DEPARTMENTS, onChange: noop },
    { key: 'status', allLabel: 'All Status', value: values.status ?? '', options: STATUSES, onChange: noop },
    { key: 'code', allLabel: 'Employee code', type: 'text', value: values.code ?? '', onChange: noop },
    { key: 'from', allLabel: 'From date', type: 'date', value: values.from ?? '', onChange: noop },
  ]
}

// Nothing set: every control shows its "all" label / placeholder and there is
// no Clear button.
export function AllEmpty() {
  return (
    <div className="ut-card px-6 py-5">
      <FilterBar filters={listFilters({})} />
    </div>
  )
}

// Two constraints narrowing the list: each active control is tinted with the
// accent tokens and the bar grows a "Clear 2 filters" button.
export function TwoActive() {
  return (
    <div className="ut-card px-6 py-5">
      <FilterBar filters={listFilters({ department: 'engineering', status: 'PENDING' })} />
    </div>
  )
}

// The audit-trail row that motivated `type` and `width`: free-text actor and
// resource id, two dates, two selects. A single active date reads
// "Clear filter" (singular).
export function AuditTrail() {
  const filters: FilterDef[] = [
    { key: 'actor', allLabel: 'Actor email', type: 'text', width: 200, value: '', onChange: noop },
    { key: 'action', allLabel: 'All Actions', value: '', options: [
      { value: 'CREATE', label: 'Create' }, { value: 'UPDATE', label: 'Update' }, { value: 'DELETE', label: 'Delete' }, { value: 'APPROVE', label: 'Approve' },
    ], onChange: noop },
    { key: 'resource', allLabel: 'All Resources', value: '', options: [
      { value: 'EMPLOYEE', label: 'Employee' }, { value: 'LEAVE', label: 'Leave request' }, { value: 'PAYROLL', label: 'Payroll run' },
    ], onChange: noop },
    { key: 'resourceId', allLabel: 'Resource id', type: 'text', width: 140, value: '', onChange: noop },
    { key: 'from', allLabel: 'From', type: 'date', value: '2026-09-01', onChange: noop },
    { key: 'to', allLabel: 'To', type: 'date', value: '', onChange: noop },
  ]
  return (
    <div className="ut-card px-6 py-5">
      <FilterBar filters={filters} />
    </div>
  )
}
