import { DataTable, HrAvatar, HrButton, HrStatusPill, TableCard, hrPaginationFooter } from '@unifiedtree/design-sync-entry'
import type { Column, FilterDef, PillTone } from '@unifiedtree/design-sync-entry'
import { Download, Plus } from 'lucide-react'

type AdvanceStatus = 'PENDING' | 'APPROVED' | 'DISBURSED' | 'REJECTED'
type Advance = {
  id: string
  employeeName: string
  employeeCode: string
  department: string
  amount: number
  repaymentMonths: number
  status: AdvanceStatus
  requestedOn: string
}

const STATUS_TONE: Record<AdvanceStatus, PillTone> = { PENDING: 'warn', APPROVED: 'ok', DISBURSED: 'info', REJECTED: 'red' }
const STATUS_LABEL: Record<AdvanceStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', DISBURSED: 'Disbursed', REJECTED: 'Rejected' }
const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
const noop = () => {}

const DEPARTMENTS = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
  { value: 'people-ops', label: 'People Ops' },
]
const STATUSES = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))

const advances: Advance[] = [
  { id: 'a1', employeeName: 'Priya Raghavan', employeeCode: 'EMP-0142', department: 'Engineering', amount: 60000, repaymentMonths: 6, status: 'PENDING', requestedOn: '18 Sep 2026' },
  { id: 'a2', employeeName: 'Arjun Mehta', employeeCode: 'EMP-0087', department: 'Sales', amount: 25000, repaymentMonths: 3, status: 'APPROVED', requestedOn: '15 Sep 2026' },
  { id: 'a3', employeeName: 'Sneha Kulkarni', employeeCode: 'EMP-0211', department: 'Finance', amount: 120000, repaymentMonths: 12, status: 'DISBURSED', requestedOn: '2 Sep 2026' },
  { id: 'a4', employeeName: 'Rohan Das', employeeCode: 'EMP-0056', department: 'Operations', amount: 15000, repaymentMonths: 2, status: 'REJECTED', requestedOn: '29 Aug 2026' },
  { id: 'a5', employeeName: 'Fatima Sheikh', employeeCode: 'EMP-0198', department: 'People Ops', amount: 40000, repaymentMonths: 4, status: 'APPROVED', requestedOn: '26 Aug 2026' },
]

// The same list narrowed to one department: what the card shows once a filter is set.
const engineeringAdvances: Advance[] = [
  { id: 'e1', employeeName: 'Priya Raghavan', employeeCode: 'EMP-0142', department: 'Engineering', amount: 60000, repaymentMonths: 6, status: 'PENDING', requestedOn: '18 Sep 2026' },
  { id: 'e2', employeeName: 'Karthik Iyer', employeeCode: 'EMP-0173', department: 'Engineering', amount: 35000, repaymentMonths: 5, status: 'APPROVED', requestedOn: '11 Sep 2026' },
  { id: 'e3', employeeName: 'Neha Bansal', employeeCode: 'EMP-0229', department: 'Engineering', amount: 80000, repaymentMonths: 8, status: 'DISBURSED', requestedOn: '4 Sep 2026' },
  { id: 'e4', employeeName: 'Vikram Nair', employeeCode: 'EMP-0064', department: 'Engineering', amount: 20000, repaymentMonths: 2, status: 'APPROVED', requestedOn: '30 Aug 2026' },
]

const columns: Column<Advance>[] = [
  { key: 'employee', header: 'Employee', render: (a) => <HrAvatar name={a.employeeName} sub={a.employeeCode} /> },
  { key: 'department', header: 'Department' },
  {
    key: 'amount',
    header: 'Advance',
    render: (a) => (
      <div>
        <p className="font-semibold tabular-nums">{inr(a.amount)}</p>
        <p className="mt-1 text-xs text-gray-500">{a.repaymentMonths} monthly installments</p>
      </div>
    ),
  },
  { key: 'status', header: 'Status', render: (a) => <HrStatusPill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</HrStatusPill> },
  { key: 'requestedOn', header: 'Requested' },
]

// The list-screen toolbar (Employees.tsx shape): search on the left, the
// shared FilterBar beside it, screen-level actions on the right, rows below.
export function SearchFiltersActions() {
  const filters: FilterDef[] = [
    { key: 'department', allLabel: 'All Departments', value: '', options: DEPARTMENTS, onChange: noop },
    { key: 'status', allLabel: 'All Status', value: '', options: STATUSES, onChange: noop },
  ]
  return (
    <TableCard
      search={{ value: '', onChange: noop, placeholder: 'Search name, code, email…' }}
      filters={filters}
      actions={
        <>
          <HrButton variant="ghost"><Download size={15} /> Export CSV</HrButton>
          <HrButton><Plus size={15} /> New advance</HrButton>
        </>
      }
    >
      <DataTable<Advance> columns={columns} data={advances} keyField="id" />
    </TableCard>
  )
}

// A filtered, server-paginated list (AdvanceAdmin.tsx shape): the active
// department filter is tinted with its Clear button, the count strip sits
// above the rows, and `hrPaginationFooter` fills the footer slot.
export function FilteredWithPaginationFooter() {
  const filters: FilterDef[] = [
    { key: 'department', allLabel: 'All Departments', value: 'engineering', options: DEPARTMENTS, onChange: noop },
    { key: 'status', allLabel: 'All Status', value: '', options: STATUSES, onChange: noop },
  ]
  return (
    <TableCard
      search={{ value: '', onChange: noop, placeholder: 'Search name, code, email…' }}
      filters={filters}
      onClearFilters={noop}
      footer={hrPaginationFooter({ page: 0, pageSize: 20, totalElements: 37, totalPages: 2, onPageChange: noop })}
    >
      <div className="border-b border-border-default px-5 py-3 text-xs text-text-secondary">37 matching requests</div>
      <DataTable<Advance> columns={columns} data={engineeringAdvances} keyField="id" />
    </TableCard>
  )
}

type Installment = { id: string; installment: string; dueOn: string; amount: number; status: 'RECOVERED' | 'DUE' | 'UPCOMING' }
const INSTALLMENT_TONE: Record<Installment['status'], PillTone> = { RECOVERED: 'ok', DUE: 'warn', UPCOMING: 'gray' }
const INSTALLMENT_LABEL: Record<Installment['status'], string> = { RECOVERED: 'Recovered', DUE: 'Due this cycle', UPCOMING: 'Upcoming' }
const schedule: Installment[] = [
  { id: 's1', installment: '1 of 6', dueOn: '30 Jul 2026', amount: 10000, status: 'RECOVERED' },
  { id: 's2', installment: '2 of 6', dueOn: '31 Aug 2026', amount: 10000, status: 'RECOVERED' },
  { id: 's3', installment: '3 of 6', dueOn: '30 Sep 2026', amount: 10000, status: 'DUE' },
  { id: 's4', installment: '4 of 6', dueOn: '31 Oct 2026', amount: 10000, status: 'UPCOMING' },
]

// Children only, no toolbar and no footer: the recovery-schedule card inside
// an advance's detail drawer.
export function Bare() {
  const cols: Column<Installment>[] = [
    { key: 'installment', header: 'Installment' },
    { key: 'dueOn', header: 'Due on' },
    { key: 'amount', header: 'Amount', render: (s) => <span className="font-semibold tabular-nums">{inr(s.amount)}</span> },
    { key: 'status', header: 'Status', render: (s) => <HrStatusPill tone={INSTALLMENT_TONE[s.status]}>{INSTALLMENT_LABEL[s.status]}</HrStatusPill> },
  ]
  return (
    <TableCard>
      <DataTable<Installment> columns={cols} data={schedule} keyField="id" emptyMessage="No recovery installments." />
    </TableCard>
  )
}
