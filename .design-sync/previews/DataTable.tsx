import { DataTable, HrAvatar, HrButton, HrStatusPill, TableCard } from '@unifiedtree/design-sync-entry'
import type { Column, PillTone } from '@unifiedtree/design-sync-entry'
import { ChevronRight } from 'lucide-react'

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

const advances: Advance[] = [
  { id: 'a1', employeeName: 'Priya Raghavan', employeeCode: 'EMP-0142', department: 'Engineering', amount: 60000, repaymentMonths: 6, status: 'PENDING', requestedOn: '18 Sep 2026' },
  { id: 'a2', employeeName: 'Arjun Mehta', employeeCode: 'EMP-0087', department: 'Sales', amount: 25000, repaymentMonths: 3, status: 'APPROVED', requestedOn: '15 Sep 2026' },
  { id: 'a3', employeeName: 'Sneha Kulkarni', employeeCode: 'EMP-0211', department: 'Finance', amount: 120000, repaymentMonths: 12, status: 'DISBURSED', requestedOn: '2 Sep 2026' },
  { id: 'a4', employeeName: 'Rohan Das', employeeCode: 'EMP-0056', department: 'Operations', amount: 15000, repaymentMonths: 2, status: 'REJECTED', requestedOn: '29 Aug 2026' },
  { id: 'a5', employeeName: 'Fatima Sheikh', employeeCode: 'EMP-0198', department: 'People Ops', amount: 40000, repaymentMonths: 4, status: 'APPROVED', requestedOn: '26 Aug 2026' },
]

// The list-screen composition (AdvanceAdmin.tsx shape): avatar cell, ₹ amounts,
// a status pill and a ghost row action, all inside TableCard.
export function AdvanceRequests() {
  const columns: Column<Advance>[] = [
    { key: 'employee', header: 'Employee', render: (a) => <HrAvatar name={a.employeeName} sub={a.employeeCode} /> },
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
    {
      key: 'details',
      header: '',
      render: (a) => (
        <HrButton size="sm" variant="ghost" aria-label={`View advance for ${a.employeeName}`}>
          View <ChevronRight size={14} />
        </HrButton>
      ),
    },
  ]
  return (
    <TableCard>
      <DataTable<Advance> columns={columns} data={advances} keyField="id" />
    </TableCard>
  )
}

// Plain columns straight from row fields; sortable headers show the caret once
// a column is clicked.
export function SortableColumns() {
  const columns: Column<Advance>[] = [
    { key: 'employeeName', header: 'Employee', sortable: true },
    { key: 'department', header: 'Department', sortable: true },
    { key: 'amount', header: 'Amount', sortable: true, render: (a) => <span className="tabular-nums">{inr(a.amount)}</span> },
    { key: 'requestedOn', header: 'Requested' },
  ]
  return (
    <div className="ut-card overflow-hidden">
      <DataTable<Advance> columns={columns} data={advances} keyField="id" />
    </div>
  )
}

// No rows: the emptyMessage row. (The `loading` state is deliberately not
// shown — its skeleton rows are bg-white/50 on a white card and capture as a
// blank box; see NOTES.md.)
export function Empty() {
  const columns: Column<Advance>[] = [
    { key: 'employeeName', header: 'Employee' },
    { key: 'amount', header: 'Amount' },
    { key: 'status', header: 'Status' },
  ]
  return (
    <div className="ut-card overflow-hidden">
      <DataTable<Advance> columns={columns} data={[]} keyField="id" emptyMessage="No advances match this status." />
    </div>
  )
}
