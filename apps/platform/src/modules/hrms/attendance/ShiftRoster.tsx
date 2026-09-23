import { useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useEmployeeShift } from '../api/useShiftPolicies'
import { EmployeeShiftAction } from './EmployeeShiftAction'
import { HrButton, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'

function ShiftRow({ employee }: { employee: WorkforceEmployee }) {
  const query = useEmployeeShift(employee.id)
  const name = `${employee.firstName} ${employee.lastName || ''}`
  const shift = query.data
  // A future-dated change is reported separately from the shift in force
  // today; showing it here is what lets HR see "on which day" at a glance.
  const upcoming = shift?.upcomingShiftName && shift.upcomingEffectiveFrom
    ? <p className="mt-1 text-xs font-semibold text-accent-fg">→ {shift.upcomingShiftName} from {shift.upcomingEffectiveFrom}</p> : null
  return <tr><td><strong>{name}</strong><p className="text-xs">{employee.employeeCode}</p></td><td>{query.isLoading ? 'Loading...' : query.isError ? <HrButton variant="ghost" onClick={() => query.refetch()}>Retry shift</HrButton> : <>{shift?.shiftName || 'Unassigned'}{upcoming}</>}</td><td>{shift?.startTime?.slice(0, 5) || '--'} – {shift?.endTime?.slice(0, 5) || '--'}</td><td>{shift?.effectiveFrom || '--'}{shift?.effectiveTo ? <p className="text-xs text-text-secondary">until {shift.effectiveTo}</p> : null}</td><td><EmployeeShiftAction employeeId={employee.id} companyId={employee.companyId} name={name} /></td></tr>
}
export function ShiftRoster({ companyId }: { companyId: string }) {
  const directory = usePermission('hrms.employee.read')
  const [page, setPage] = useState(0), [search, setSearch] = useState('')
  const query = useEmployeeDirectory({ companyId, search, page, pageSize: 10 }, { enabled: directory && !!companyId })
  if (!directory) return <p className="ut-card p-5">Employee directory access is required to view the company shift roster.</p>
  return <div className="space-y-4"><div><h3 className="font-semibold">Current shift roster</h3><p className="text-sm text-text-secondary">Current assignments and their effective dates. Use Change shift to update an employee's assignment.</p></div><label className="block text-sm">Find employee<input type="search" className="ut-input max-w-md" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder="Search name or employee code" /></label>
    {query.isError ? <div role="alert"><p>{query.error.message}</p><HrButton onClick={() => query.refetch()}>Retry</HrButton></div> : <TableCard><div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Employee</th><th>Shift</th><th>Timings</th><th>Effective from</th><th>Action</th></tr></thead><tbody>{query.isLoading ? <tr><td colSpan={5}>Loading roster...</td></tr> : !query.data?.content.length ? <tr><td colSpan={5}>No employees match.</td></tr> : query.data.content.map(e => <ShiftRow key={e.id} employee={e} />)}</tbody></table></div></TableCard>}
    <HrPagination page={page} pageSize={10} totalElements={query.data?.totalElements || 0} totalPages={query.data?.totalPages || 0} onPageChange={setPage} />
  </div>
}
