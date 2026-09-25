// People (/hrms/performance?view=people): the performance directory,
// GET /v1/performance/employees (hrms.performance.read). HR and admin see the
// company; a department manager only their team (the API scopes it). Each row
// opens the person's performance page.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { HrAvatar, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { DataTable } from '@/shared/components/DataTable'
import { SubHeading, Note, dmy } from '@/design/module/ModuleKit'
import { usePerformanceDirectory, type EmployeePerformanceRow } from '../api/usePerformance'
import { PerformanceError } from './PerformanceEmployeePicker'
import { statusWords } from './shared'

const REVIEW_TONE: Record<string, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal', MISSED: 'red' }

export function PerformanceDirectory() {
  const navigate = useNavigate()
  // Without performance.write this is a department manager: the API returns their team only.
  const teamOnly = !usePermission('hrms.performance.write')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const query = usePerformanceDirectory({ search: search.trim() || undefined, page, size })
  const totalPages = Math.ceil((query.data?.total ?? 0) / size)
  useClampedPage(page, totalPages, setPage)
  const open = (row: EmployeePerformanceRow) => navigate(`/hrms/performance/employees/${row.employeeId}`)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubHeading>{teamOnly ? 'Your team' : 'People'}</SubHeading>
      <Note>{teamOnly
        ? 'You see your team: everyone in the departments you head, or your direct reports if you don’t head one. Open a person to see their reviews, goals and ratings over time.'
        : 'Everyone with their latest review. Open a person to see their reviews, goals and KPIs, and their ratings over time.'}</Note>
      <label className="max-w-md text-xs font-medium text-text-secondary">Search people
        <input className="ut-input mt-1" type="search" value={search} placeholder="Name or employee code" onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
      </label>
      {query.isError ? <PerformanceError error={query.error} retry={() => query.refetch()} /> : (
        <TableCard footer={<HrPagination page={page} pageSize={size} totalElements={query.data?.total ?? 0} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={setSize} />}>
          <DataTable<EmployeePerformanceRow> data={query.data?.items ?? []} keyField="employeeId" loading={query.isLoading}
            emptyMessage={search ? 'No one matches this search.' : teamOnly ? 'No one in your team yet.' : 'No active employees yet.'}
            columns={[
              { key: 'employee', header: 'Employee', render: (row) => <button type="button" className="text-left hover:underline" onClick={() => open(row)}><HrAvatar name={row.employeeName || 'Employee'} sub={row.employeeCode || undefined} /></button> },
              { key: 'department', header: 'Department', render: (row) => <span className="text-text-secondary">{row.department || 'No department'}</span> },
              { key: 'rating', header: 'Latest rating', render: (row) => <span className="font-semibold tabular-nums">{row.overallRating == null ? 'Not rated yet' : `${row.overallRating} / 5`}</span> },
              { key: 'cycle', header: 'Last review', render: (row) => <span className="text-text-secondary">{row.lastReviewCycleName ? `${row.lastReviewCycleName}${row.lastReviewSubmittedAt ? ` · ${dmy(row.lastReviewSubmittedAt)}` : ''}` : '—'}</span> },
              { key: 'status', header: 'Status', render: (row) => row.lastReviewStatus ? <HrStatusPill tone={REVIEW_TONE[row.lastReviewStatus] || 'gray'}>{statusWords(row.lastReviewStatus)}</HrStatusPill> : <span className="text-xs text-text-tertiary">No reviews</span> },
              { key: 'open', header: 'Details', render: (row) => <HrButton size="sm" variant="ghost" onClick={() => open(row)}>Open</HrButton> },
            ]} />
        </TableCard>
      )}
    </div>
  )
}
