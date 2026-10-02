// Find a person by name, code or email (server search, paged), on the kit
// (P-DOCS: generate a letter, preview as, whose file, add and bulk-upload a
// document). Needs the employee directory (hrms.employee.read); without it the
// field says so instead of listing anyone. Each result is a button named after
// the person, so "Reader User" can be picked by name.
import { useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Avatar, Button, Callout } from '@/design/kit/display'
import { Input } from '@/design/kit/overlays'
import { useEmployeeDirectory, type WorkforceEmployee } from '../../api/useWorkforce'
import '../components/letters.css'

export const fullName = (e: Pick<WorkforceEmployee, 'firstName' | 'lastName'>) => [e.firstName, e.lastName].filter(Boolean).join(' ')

const PAGE = 8

export function PersonSearch({ selectedId, onPick, companyId, label = 'Find employee', hint, autoFocus }: {
  selectedId?: string
  onPick: (employee: WorkforceEmployee) => void
  /** Only people in this company (e.g. a letter template's company). */
  companyId?: string
  label?: string
  hint?: string
  autoFocus?: boolean
}) {
  const allowed = usePermission(P.HRMS_EMPLOYEE_READ)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const q = useEmployeeDirectory({ companyId, search: search.trim() || undefined, page, pageSize: PAGE }, { enabled: allowed })
  if (!allowed) return <Callout tone="neutral">You need access to the employee directory to choose someone.</Callout>
  const rows = q.data?.content ?? []
  const pages = q.data?.totalPages ?? 0
  return (
    <div className="lt-person">
      <Input label={label} type="search" value={search} hint={hint} placeholder="Search by name, code or email" autoFocus={autoFocus}
        onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
      <div className="lt-person__list" aria-busy={q.isFetching || undefined} aria-label="Matching people" role="group">
        {q.isError ? <p role="alert" className="lt-person__note">{(q.error as Error)?.message || 'Couldn’t search the directory.'}{' '}
          <button type="button" className="lt-link" onClick={() => q.refetch()}>Try again</button></p>
          : q.isLoading ? <p role="status" className="lt-person__note">Loading people…</p>
            : rows.length === 0 ? <p className="lt-person__note">No one matches this search.</p>
              : rows.map((e) => (
                <button type="button" key={e.id} className="lt-person__row" aria-pressed={selectedId === e.id} onClick={() => onPick(e)}>
                  <Avatar name={fullName(e)} size={28} />
                  <span className="lt-person__text">
                    <span className="lt-person__name">{fullName(e)}</span>
                    <span className="lt-person__sub">{[e.employeeCode, e.email].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
      </div>
      {pages > 1 && (
        <div className="lt-person__pager">
          <Button size={30} variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
          <span>{`${page + 1} of ${pages}`}</span>
          <Button size={30} variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
