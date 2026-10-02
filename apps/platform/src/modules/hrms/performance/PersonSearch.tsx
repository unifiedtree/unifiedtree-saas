// Find a person (server-searched, paged) inside the P-GROW panels. Needs hrms.employee.read;
// without it the panel says so instead of listing anyone. Today's PerformanceEmployeePicker
// stays for the other pages that use it.
import { useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Input } from '@/design/kit/overlays'
import { Callout, SkeletonList } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'

export const personName = (e: { firstName: string; lastName?: string | null }) => `${e.firstName} ${e.lastName || ''}`.trim()

export function PersonSearch({ value, selectedLabel, onChange, companyId, label = 'Find employee', disabled }: {
  value: string
  selectedLabel?: string
  onChange: (employee: WorkforceEmployee) => void
  companyId?: string
  label?: string
  /** Rows that can't be picked (e.g. already chosen), with why. */
  disabled?: (employee: WorkforceEmployee) => string | null
}) {
  const allowed = usePermission(P.HRMS_EMPLOYEE_READ)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const query = useEmployeeDirectory({ companyId, search: search.trim() || undefined, page, pageSize: 10 }, { enabled: allowed })
  if (!allowed) return <Callout tone="neutral">You need access to the employee directory to choose someone.</Callout>
  const rows = query.data?.content ?? []
  return (
    <div className="grw-stack grw-stack--tight">
      {value && <Callout tone="brand" icon="checkCircle">{`Selected: ${selectedLabel || value}`}</Callout>}
      <Input label={label} type="search" value={search} placeholder="Search by name, code or email" onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
      <div className="grw-results" aria-busy={query.isFetching}>
        {query.isLoading ? <div style={{ padding: 10 }}><SkeletonList rows={3} /></div>
          : query.isError ? <p className="grw-muted" role="alert" style={{ margin: 0, padding: 12 }}>Couldn’t search employees. Try again.</p>
            : rows.length === 0 ? <p className="grw-muted" style={{ margin: 0, padding: 12 }}>No employees match this search.</p>
              : rows.map((e) => {
                const why = disabled?.(e) ?? null
                return (
                  <button type="button" key={e.id} className="grw-result" aria-pressed={value === e.id} disabled={!!why} onClick={() => onChange(e)}>
                    <span style={{ minWidth: 0 }}>
                      <span className="grw-strong" style={{ display: 'block' }}>{personName(e)}</span>
                      <span className="grw-muted">{[e.employeeCode, e.email].filter(Boolean).join(' · ')}</span>
                    </span>
                    {why && <span className="grw-muted">{why}</span>}
                  </button>
                )
              })}
      </div>
      {(query.data?.totalPages ?? 0) > 1 && (
        <Pager page={page} pageSize={10} total={query.data?.totalElements ?? 0} onPageChange={setPage} noun="people" />
      )}
    </div>
  )
}
