import { useState } from 'react'
import { useEmployeeStructure } from '../api/usePayroll'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { HrButton, TableCard } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { inr } from '../api/usePayrollRuns'
function SalaryRow({ employee, onSelect }: { employee: WorkforceEmployee; onSelect: (e: WorkforceEmployee) => void }) {
  const q = useEmployeeStructure(employee.id)
  const money = (value?: number) => value == null ? 'Not calculated' : inr(value)
  return <tr><td><strong>{employee.firstName} {employee.lastName}</strong><p className="text-xs">{employee.employeeCode}</p></td>{q.isError ? <td colSpan={4}><HrButton variant="ghost" onClick={() => q.refetch()}>Retry salary</HrButton></td> : q.isLoading ? <td colSpan={4}>Loading salary...</td> : <><td>{q.data ? money(q.data.ctcAnnual) : 'Not configured'}</td><td>{money(q.data?.grossMonthly)}</td><td>{money(q.data?.totalDeductions)}</td><td>{money(q.data?.netMonthly)}</td></>}<td><HrButton variant="ghost" onClick={() => onSelect(employee)}>View breakdown</HrButton></td></tr>
}
export function SalaryOverview({ companyId, onSelect }: { companyId: string; onSelect: (e: WorkforceEmployee) => void }) {
  const [page, setPage] = useState(0), [search, setSearch] = useState('')
  const q = useEmployeeDirectory({ companyId: companyId || undefined, search, page, pageSize: 10 })
  return <div className="space-y-4"><p className="text-sm text-text-secondary">Monthly salary estimates from the payroll engine, before attendance adjustments. Open a breakdown to review components and revision history.</p><label className="block text-sm">Find employee<input className="ut-input max-w-md" type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>{q.isError ? <div role="alert"><p>{q.error.message}</p><HrButton onClick={() => q.refetch()}>Retry</HrButton></div> : <TableCard><div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Employee</th><th>Annual CTC</th><th>Monthly gross</th><th>Deductions</th><th>Estimated net</th><th>Action</th></tr></thead><tbody>{q.isLoading ? <tr><td colSpan={6}>Loading employees...</td></tr> : !q.data?.content.length ? <tr><td colSpan={6}>No employees found.</td></tr> : q.data.content.map(e => <SalaryRow key={e.id} employee={e} onSelect={onSelect} />)}</tbody></table></div></TableCard>}<HrPagination page={page} pageSize={10} totalElements={q.data?.totalElements || 0} totalPages={q.data?.totalPages || 0} onPageChange={setPage} /></div>
}
