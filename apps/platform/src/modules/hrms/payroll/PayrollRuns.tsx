import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { DataTable, Badge, Button, Modal, Field, Input, type Column } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import {
  useRuns, useCreateRun, MONTHS, statusTone, inr,
  type PayrollRun,
} from '../api/usePayrollRuns'

export const PayrollRuns: React.FC = () => {
  const { toast } = useToast()
  const nav = useNavigate()
  const { data = [], isLoading } = useRuns()
  const { data: companies = [] } = useCompanies()
  const create = useCreateRun()

  const [open, setOpen] = useState(false)
  const now = new Date()
  const [companyId, setCompanyId] = useState('')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const openModal = () => {
    setCompanyId(companies.length === 1 ? companies[0].id : '')
    setMonth(now.getMonth() + 1)
    setYear(now.getFullYear())
    setOpen(true)
  }

  const submit = () => {
    create.mutate(
      { companyId, periodMonth: month, periodYear: year },
      {
        onSuccess: (run) => {
          setOpen(false)
          toast('Payroll run created', 'success')
          nav(`/hrms/payroll/runs/${run.id}`)
        },
        onError: (e) => toast((e as Error).message, 'error'),
      },
    )
  }

  const columns: Column<PayrollRun>[] = [
    { key: 'period', header: 'Period', cell: (r) => <span className="font-semibold text-slate-900">{MONTHS[r.periodMonth - 1]} {r.periodYear}</span> },
    { key: 'company', header: 'Company', cell: (r) => r.companyName, hideBelow: 'sm' },
    { key: 'employees', header: 'Employees', cell: (r) => r.employeeCount },
    { key: 'net', header: 'Net pay', cell: (r) => inr(r.totalNet), hideBelow: 'md' },
    { key: 'status', header: 'Status', cell: (r) => <Badge tone={statusTone[r.status]}>{r.status}</Badge> },
  ]

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">Payroll Runs</h1>
          <p className="text-sm text-slate-500 mt-1">Process monthly payroll, review payslips and lock the period.</p>
        </div>
        <Can code={P.PAYROLL_RUNS_MANAGE}>
          <Button onClick={openModal}><Plus size={16} /> New run</Button>
        </Can>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <DataTable
          columns={columns}
          data={data}
          getRowKey={(r) => r.id}
          isLoading={isLoading}
          onRowClick={(r) => nav(`/hrms/payroll/runs/${r.id}`)}
          emptyTitle="No payroll runs"
          emptyDescription="Create your first run to begin processing payroll."
        />
      </div>

      <Modal open={open} onOpenChange={setOpen} title="New payroll run" size="md">
        <div className="space-y-4">
          <Field label="Company" required>
            <select
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Month" required>
              <select
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Year" required>
              <Input
                type="number"
                min={2020}
                max={2099}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={!companyId} onClick={submit}>Create run</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
