// Who someone reports to, picked by name: type part of a name, email or employee code and
// choose from the company's people. It used to be a box asking for the manager's UUID, copied
// out of their profile's address bar. The person themself and people who have left are not
// offered (the server refuses both). The empty choice says what it means: approvals then go
// to the department head.
import { useId, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { FormField } from '@/design/kit/overlays'
import { useEmployeeDirectory, useWorkforceEmployee, type WorkforceEmployee } from '../api/useWorkforce'

const LEFT = new Set(['EXITED', 'TERMINATED'])
const nameOf = (e: Pick<WorkforceEmployee, 'firstName' | 'lastName' | 'employeeCode'>) =>
  [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeCode
const optionLabel = (e: WorkforceEmployee) =>
  `${nameOf(e)}${e.employeeCode ? ` (${e.employeeCode})` : ''}${e.employmentStatus && LEFT.has(e.employmentStatus) ? ' · has left' : ''}`

export function ManagerPicker({ companyId, value, onChange, excludeId, label = 'Reports to', emptyLabel = 'No manager: the department head approves', hint, error, full = true }: {
  companyId?: string
  /** The manager's employee id; '' for none. */
  value: string
  onChange: (managerId: string) => void
  /** The person being edited, never their own manager. */
  excludeId?: string
  label?: string
  emptyLabel?: string
  hint?: string
  error?: string
  full?: boolean
}) {
  const ids = useId()
  const [search, setSearch] = useState('')
  const found = useEmployeeDirectory({ companyId, search: search.trim() || undefined, pageSize: 25 }, { enabled: !!companyId })
  const { data: current } = useWorkforceEmployee(value || undefined)
  const people = (found.data?.content ?? []).filter((e) => e.id !== excludeId && !(e.employmentStatus && LEFT.has(e.employmentStatus)))
  // The current manager stays listed even when the search hides them (or they have left), so the choice shows.
  const options = current && current.id === value && !people.some((e) => e.id === current.id) ? [current, ...people] : people
  const status = found.isError ? 'Couldn’t load people. Try the search again.'
    : found.isFetching ? 'Searching…'
      : !people.length && search.trim() ? 'Nobody matches this search.' : null
  return (
    <FormField label={label} htmlFor={`${ids}-search`} hint={status || hint} error={error} full={full}>
      <span className="uko-control" data-leading="">
        <span className="uko-lead" aria-hidden="true"><Search size={16} /></span>
        <input id={`${ids}-search`} className="uko-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or employee code" aria-label={`Search people for ${label}`} />
      </span>
      <span className="uko-control uko-select-wrap">
        <select className="uko-input uko-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
          aria-invalid={error ? true : undefined}>
          <option value="">{emptyLabel}</option>
          {options.map((e) => <option key={e.id} value={e.id}>{optionLabel(e)}</option>)}
        </select>
        <ChevronDown className="uko-select-chev" size={16} aria-hidden="true" />
      </span>
    </FormField>
  )
}
