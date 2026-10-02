// Performance · People (PgGrow p-center tab 3): everyone with their latest rating, last review
// and where they stand now (Reviewed · Review due · On probation, BW-82). Managers see their
// team (the API scopes it). Each person opens their performance page.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { Button, Callout, CellActions, CellPerson, EmptyState, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Input } from '@/design/kit/overlays'
import { usePerformanceDirectory, type EmployeePerformanceRow } from '../api/usePerformance'
import { personStatus, ratingText } from './growModel'

export function PeopleView() {
  const navigate = useNavigate()
  const teamOnly = !usePermission('hrms.performance.write')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const query = usePerformanceDirectory({ search: search.trim() || undefined, page, size })
  const total = query.data?.total ?? 0
  useEffect(() => { const pages = Math.ceil(total / size); if (page > 0 && page >= pages) setPage(Math.max(0, pages - 1)) }, [total, size, page])
  const open = (r: EmployeePerformanceRow) => navigate(`/hrms/performance/employees/${r.employeeId}`)
  const columns: TableColumn<EmployeePerformanceRow>[] = [
    { key: 'employee', header: 'Employee', primary: true, render: (r) => (
      <button type="button" className="grw-link" style={{ color: 'inherit' }} onClick={() => open(r)}><CellPerson name={r.employeeName || 'Employee'} sub={r.employeeCode || undefined} /></button>
    ) },
    { key: 'department', header: 'Department', render: (r) => r.department || 'No department' },
    { key: 'rating', header: 'Latest rating', render: (r) => <span className="grw-num">{r.overallRating == null ? 'Not rated yet' : ratingText(r.overallRating)}</span> },
    { key: 'cycle', header: 'Last review', render: (r) => r.lastReviewCycleName || '—' },
    { key: 'status', header: 'Status', render: (r) => { const s = personStatus(r); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
      <CellActions><Button variant="secondary" size={30} onClick={() => open(r)}>Details</Button></CellActions>
    ) },
  ]
  return (
    <>
      {teamOnly && <Callout tone="neutral">You see your team: everyone in the departments you head, or your direct reports if you don’t head one. Open a person to see their reviews, goals and ratings over time.</Callout>}
      <Section title={teamOnly ? 'Your team' : 'People'} body="flush" error={query.error} onRetry={() => query.refetch()}
        actions={<div style={{ width: 'min(100%, 280px)' }}><Input label="Search people" type="search" value={search} placeholder="Name or employee code" onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></div>}
        footer={total > size ? <Pager page={page} pageSize={size} total={total} onPageChange={setPage} onPageSizeChange={(n) => { setSize(n); setPage(0) }} noun="people" /> : undefined}>
        <Table label={teamOnly ? 'Your team' : 'People'} columns={columns} rows={query.data?.items ?? []} rowKey={(r) => r.employeeId} loading={query.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="users" title={search ? 'No one matches this search' : teamOnly ? 'No one in your team yet' : 'No active employees yet.'} />} />
      </Section>
    </>
  )
}
