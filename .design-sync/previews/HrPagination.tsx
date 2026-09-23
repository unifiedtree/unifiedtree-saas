import { DataTable, HrAvatar, HrPagination, HrStatusPill, TableCard, hrPaginationFooter } from '@unifiedtree/design-sync-entry'
import type { ReactNode } from 'react'
import type { Column, PillTone } from '@unifiedtree/design-sync-entry'

const noop = () => {}

// The pager lives in TableCard's footer strip; each bare cell sits in the same
// card + padding so it reads the way the screens show it.
function FooterStrip({ children }: { children: ReactNode }) {
  return <div className="ut-card px-6 py-4">{children}</div>
}

// Page 2 of 13 (zero-based `page: 1`) of a 248-row advance list at 20 per page:
// both arrows enabled, "Showing 21–40 of 248".
export function MiddlePage() {
  return (
    <FooterStrip>
      <HrPagination page={1} pageSize={20} totalElements={248} totalPages={13} onPageChange={noop} />
    </FooterStrip>
  )
}

// Opting into `onPageSizeChange` adds the rows-per-page select (default sizes
// 10 / 25 / 50 / 100) beside the range.
export function WithRowsPerPage() {
  return (
    <FooterStrip>
      <HrPagination page={1} pageSize={25} totalElements={412} totalPages={17} onPageChange={noop} onPageSizeChange={noop} />
    </FooterStrip>
  )
}

// On the last page the range shrinks to the remainder and "Next" is disabled
// (opacity-40); on page 0 it is "Previous" instead.
export function LastPage() {
  return (
    <FooterStrip>
      <HrPagination page={12} pageSize={20} totalElements={248} totalPages={13} onPageChange={noop} />
    </FooterStrip>
  )
}

// Everything fits on one page but a size control is offered: the bar stays
// (so the user can get back from a size that collapsed the list) while the
// nav cluster is dropped rather than drawing a dead "1 / 1".
export function SinglePageKeepsSizeControl() {
  return (
    <FooterStrip>
      <HrPagination page={0} pageSize={25} totalElements={8} totalPages={1} onPageChange={noop} onPageSizeChange={noop} />
    </FooterStrip>
  )
}

type Status = 'ACTIVE' | 'ON_NOTICE' | 'ON_LEAVE'
type Employee = { id: string; name: string; code: string; department: string; status: Status }
const TONE: Record<Status, PillTone> = { ACTIVE: 'ok', ON_NOTICE: 'orange', ON_LEAVE: 'info' }
const LABEL: Record<Status, string> = { ACTIVE: 'Active', ON_NOTICE: 'On notice', ON_LEAVE: 'On leave' }
const employees: Employee[] = [
  { id: 'e1', name: 'Priya Raghavan', code: 'EMP-0142', department: 'Engineering', status: 'ACTIVE' },
  { id: 'e2', name: 'Arjun Mehta', code: 'EMP-0087', department: 'Sales', status: 'ON_LEAVE' },
  { id: 'e3', name: 'Sneha Kulkarni', code: 'EMP-0211', department: 'Finance', status: 'ACTIVE' },
  { id: 'e4', name: 'Rohan Das', code: 'EMP-0056', department: 'Operations', status: 'ON_NOTICE' },
]

// The real integration (Employees.tsx shape): `hrPaginationFooter(...)` as
// TableCard's `footer`, under the directory rows, with the size control on.
export function AsTableCardFooter() {
  const columns: Column<Employee>[] = [
    { key: 'employee', header: 'Employee', render: (e) => <HrAvatar name={e.name} sub={e.code} /> },
    { key: 'department', header: 'Department' },
    { key: 'status', header: 'Status', render: (e) => <HrStatusPill tone={TONE[e.status]}>{LABEL[e.status]}</HrStatusPill> },
  ]
  return (
    <TableCard
      footer={hrPaginationFooter({ page: 0, pageSize: 25, totalElements: 412, totalPages: 17, onPageChange: noop, onPageSizeChange: noop })}
    >
      <DataTable<Employee> columns={columns} data={employees} keyField="id" />
    </TableCard>
  )
}
