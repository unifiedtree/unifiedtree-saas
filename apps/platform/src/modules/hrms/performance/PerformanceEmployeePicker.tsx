import { useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { HrButton } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'

export function PerformanceError({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <p>{error instanceof Error ? error.message : 'Unable to load performance information.'}</p>
    {retry && <HrButton className="mt-3" size="sm" variant="ghost" onClick={retry}>Try again</HrButton>}
  </div>
}

/** Server-searched, paged picker. Never silently truncates the company to its first 200 employees. */
export function PerformanceEmployeePicker({ value, selectedLabel, onChange, companyId }: {
  value: string; selectedLabel?: string; onChange: (employee: WorkforceEmployee) => void; companyId?: string
}) {
  const allowed = usePermission(P.HRMS_EMPLOYEE_READ)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const query = useEmployeeDirectory({ companyId, search: search || undefined, page, pageSize: 10 }, { enabled: allowed })
  if (!allowed) return <p className="text-sm text-text-secondary">Employee directory access is required to choose an owner.</p>
  return <div className="space-y-3">
    {value && <p className="rounded-md bg-[#E6F4F1] px-3 py-2 text-sm text-[#0A5240]">Selected: {selectedLabel || value}</p>}
    <label className="block text-sm font-medium">Find employee<input className="ut-input mt-1" type="search" value={search} placeholder="Search by name, code or email" onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>
    {query.isError ? <PerformanceError error={query.error} retry={() => query.refetch()} /> : <>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border-default" aria-busy={query.isFetching}>
        {query.isLoading ? <p role="status" className="p-3 text-sm">Loading employees...</p> : !query.data?.content.length ? <p className="p-3 text-sm text-text-secondary">No employees match this search.</p> : query.data.content.map(employee => <button type="button" key={employee.id} onClick={() => onChange(employee)} aria-pressed={value === employee.id} className={`block w-full border-b border-border-default px-3 py-2 text-left text-sm last:border-0 hover:bg-[#E6F4F1] ${value === employee.id ? 'bg-[#E6F4F1]' : ''}`}>
          <span className="block font-medium">{employee.firstName} {employee.lastName}</span><span className="text-xs text-text-secondary">{employee.employeeCode} · {employee.email}</span>
        </button>)}
      </div>
      <HrPagination page={page} pageSize={10} totalElements={query.data?.totalElements ?? 0} totalPages={query.data?.totalPages ?? 0} onPageChange={setPage} />
    </>}
  </div>
}
