import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Lock, Download, Users, IndianRupee, CheckCircle2 } from 'lucide-react'
import {
  DataTable, Badge, Button, StatCard, Drawer, Modal, CardSkeleton, type Column,
} from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  useRun, useRunEmployees, useProcessRun, useLockRun, useRunPayslip, downloadPayslipPdf,
  MONTHS, statusTone, inr, inr2,
  type RunEmployee,
} from '../api/usePayrollRuns'

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN') : '—')

const PayslipBody: React.FC<{ runId: string; empId: string }> = ({ runId, empId }) => {
  const { toast } = useToast()
  const { data: slip, isLoading } = useRunPayslip(runId, empId)
  if (isLoading || !slip) return <CardSkeleton />

  const Section: React.FC<{ title: string; lines: { code: string; name: string; amount: number }[] }> = ({ title, lines }) => (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{title}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-slate-400">None</p>
      ) : lines.map((l) => (
        <div key={l.code} className="flex justify-between text-sm py-0.5">
          <span className="text-slate-600">{l.name}</span>
          <span className="text-slate-900 tabular-nums">{inr2(l.amount)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-2">
      <div>
        <p className="text-lg font-bold text-slate-900">{slip.employeeName}</p>
        <p className="text-xs text-slate-500 font-mono">{slip.employeeCode} · {slip.period}</p>
        {slip.designation && <p className="text-xs text-slate-500">{slip.designation}</p>}
      </div>
      <div className="flex gap-4 text-xs text-slate-500">
        <span>Paid days: <b className="text-slate-700">{slip.paidDays ?? '—'}</b></span>
        <span>LOP days: <b className="text-slate-700">{slip.lopDays ?? '—'}</b></span>
      </div>

      <Section title="Earnings" lines={slip.earnings} />
      <div className="flex justify-between text-sm font-semibold border-t border-slate-200 pt-1">
        <span>Gross earnings</span><span className="tabular-nums">{inr2(slip.gross)}</span>
      </div>

      <Section title="Deductions" lines={slip.deductions} />
      <div className="flex justify-between text-sm font-semibold border-t border-slate-200 pt-1">
        <span>Total deductions</span><span className="tabular-nums">{inr2(slip.totalDeductions)}</span>
      </div>

      <div className="flex justify-between text-base font-bold text-[#0F6E56] border-t-2 border-[#0F6E56] pt-2 mt-2">
        <span>Net pay</span><span className="tabular-nums">{inr2(slip.netPay)}</span>
      </div>

      {slip.employerContributions.length > 0 && (
        <Section title="Employer contributions (not deducted)" lines={slip.employerContributions} />
      )}

      <div className="pt-4">
        <Can code={P.PAYROLL_RUNS_READ}>
          <Button variant="ghost" onClick={async () => {
            try { await downloadPayslipPdf(runId, empId) } catch (e) { toast((e as Error).message, 'error') }
          }}><Download size={15} /> Download PDF</Button>
        </Can>
      </div>
    </div>
  )
}

export const PayrollRunDetail: React.FC = () => {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { toast } = useToast()
  const { data: run, isLoading } = useRun(id)
  const { data: emps = [], isLoading: empsLoading } = useRunEmployees(id)
  const process = useProcessRun(id)
  const lock = useLockRun(id)

  const [tab, setTab] = useState<'overview' | 'employees'>('overview')
  const [slipEmp, setSlipEmp] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'process' | 'lock'>(null)

  if (isLoading || !run) return <div className="max-w-6xl mx-auto p-6 sm:p-8"><CardSkeleton /></div>

  const runAction = () => {
    if (confirm === 'process') {
      process.mutate(undefined, {
        onSuccess: () => { setConfirm(null); toast('Payroll processed', 'success') },
        onError: (e) => toast((e as Error).message, 'error'),
      })
    } else if (confirm === 'lock') {
      lock.mutate(undefined, {
        onSuccess: () => { setConfirm(null); toast('Payroll locked', 'success') },
        onError: (e) => toast((e as Error).message, 'error'),
      })
    }
  }

  const confirmCopy = confirm === 'lock'
    ? { title: 'Lock this payroll run?', desc: 'Locking freezes the numbers and makes payslips available to employees. This cannot be undone.' }
    : { title: 'Process payroll?', desc: 'This recalculates every employee payslip from current attendance, leave and salary structures.' }

  const empColumns: Column<RunEmployee>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.employeeCode}</span> },
    { key: 'name', header: 'Employee', cell: (r) => r.employeeName },
    { key: 'paid', header: 'Paid', cell: (r) => r.paidDays, hideBelow: 'sm' },
    { key: 'lop', header: 'LOP', cell: (r) => r.lopDays, hideBelow: 'sm' },
    { key: 'gross', header: 'Gross', cell: (r) => inr(r.gross), hideBelow: 'md' },
    { key: 'net', header: 'Net pay', cell: (r) => <span className="font-semibold">{inr(r.netPay)}</span> },
    { key: 'actions', header: '', cell: (r) => (
      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setSlipEmp(r.employeeId) }}>Payslip</Button>
    ) },
  ]

  return (
    <div className="max-w-6xl mx-auto p-6 sm:p-8 space-y-6">
      <button onClick={() => nav('/hrms/payroll/runs')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> Payroll runs
      </button>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">
              {MONTHS[run.periodMonth - 1]} {run.periodYear}
            </h1>
            <Badge tone={statusTone[run.status]}>{run.status}</Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">{run.companyName}</p>
        </div>
        <div className="flex items-center gap-2">
          {run.status === 'DRAFT' && (
            <Can code={P.PAYROLL_RUNS_MANAGE}>
              <Button onClick={() => setConfirm('process')} loading={process.isPending}><Play size={15} /> Process</Button>
            </Can>
          )}
          {run.status === 'PROCESSING' && (
            <>
              <Can code={P.PAYROLL_RUNS_MANAGE}>
                <Button variant="ghost" onClick={() => setConfirm('process')} loading={process.isPending}>Re-process</Button>
              </Can>
              <Can code={P.PAYROLL_RUNS_LOCK}>
                <Button onClick={() => setConfirm('lock')} loading={lock.isPending}><Lock size={15} /> Lock</Button>
              </Can>
            </>
          )}
          {run.status === 'LOCKED' && (
            <span className="flex items-center gap-1.5 text-sm text-[#0F6E56] font-medium">
              <CheckCircle2 size={16} /> Finalized · locked {fmtDate(run.lockedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Employees" value={run.employeeCount} icon={Users} />
        <StatCard label="Gross" value={inr(run.totalGross)} icon={IndianRupee} tone="info" />
        <StatCard label="Deductions" value={inr(run.totalDeductions)} tone="warning" />
        <StatCard label="Net pay" value={inr(run.totalNet)} icon={IndianRupee} tone="success" />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(['overview', 'employees'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 capitalize ${
              tab === t ? 'border-[#0F6E56] text-[#0F6E56]' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Row k="Period" v={`${run.periodStart} → ${run.periodEnd}`} />
          <Row k="Company" v={run.companyName} />
          <Row k="Status" v={run.status} />
          <Row k="Employees" v={String(run.employeeCount)} />
          <Row k="Processed" v={fmtDate(run.processedAt)} />
          <Row k="Locked" v={fmtDate(run.lockedAt)} />
          <Row k="Created" v={fmtDate(run.createdAt)} />
        </div>
      )}

      {tab === 'employees' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <DataTable
            columns={empColumns}
            data={emps}
            getRowKey={(r) => r.employeeId}
            isLoading={empsLoading}
            onRowClick={(r) => setSlipEmp(r.employeeId)}
            emptyTitle="No payslips yet"
            emptyDescription={run.status === 'DRAFT' ? 'Process the run to generate payslips.' : 'No eligible employees for this period.'}
          />
        </div>
      )}

      <Drawer open={!!slipEmp} onOpenChange={(o) => !o && setSlipEmp(null)} title="Payslip">
        {slipEmp && <PayslipBody runId={id} empId={slipEmp} />}
      </Drawer>

      <Modal open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirmCopy.title} description={confirmCopy.desc} size="sm">
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button loading={process.isPending || lock.isPending} onClick={runAction}>Confirm</Button>
        </div>
      </Modal>
    </div>
  )
}

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex justify-between sm:block">
    <span className="text-slate-400">{k}</span>
    <span className="text-slate-800 sm:block sm:mt-0.5 font-medium">{v}</span>
  </div>
)
