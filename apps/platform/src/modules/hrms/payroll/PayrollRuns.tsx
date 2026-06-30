import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Modal, Field, Input } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { HrPageHeader, HrButton, TableCard, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useRuns, useCreateRun, MONTHS, statusTone, inr } from '../api/usePayrollRuns'

// Map the ui-kit Badge tone returned by statusTone[...] onto the client pill palette.
const TONE_MAP: Record<string, PillTone> = {
  success: 'ok', warning: 'warn', danger: 'red', error: 'red', info: 'info', default: 'gray', neutral: 'gray',
}

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
    // Guard before hitting the API: a cleared year input yields Number('') === 0,
    // which the backend rejects (out of the 2020–2099 range).
    if (!Number.isInteger(year) || year < 2020 || year > 2099) {
      toast('Year must be between 2020 and 2099', 'error')
      return
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      toast('Month must be between 1 and 12', 'error')
      return
    }
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

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="Processing & Payslips"
        subtitle="Process monthly payroll, review payslips and lock the period."
        actions={
          <Can code={P.PAYROLL_RUNS_MANAGE}>
            <HrButton onClick={openModal}><Plus size={15} /> New run</HrButton>
          </Can>
        }
      />

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Period</th>
              <th className="hidden sm:table-cell">Company</th>
              <th>Employees</th>
              <th className="hidden md:table-cell">Net pay</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <p className="text-sm font-semibold text-text-secondary">No payroll runs</p>
                  <p className="mt-1 text-xs text-text-tertiary">Create your first run to begin processing payroll.</p>
                </td>
              </tr>
            ) : data.map((r) => (
              <tr key={r.id} onClick={() => nav(`/hrms/payroll/runs/${r.id}`)} className="cursor-pointer">
                <td className="font-semibold text-text-primary">{MONTHS[r.periodMonth - 1]} {r.periodYear}</td>
                <td className="hidden sm:table-cell text-text-secondary">{r.companyName}</td>
                <td className="text-text-secondary">{r.employeeCount}</td>
                <td className="hidden md:table-cell text-text-secondary">{inr(r.totalNet)}</td>
                <td><HrStatusPill tone={TONE_MAP[statusTone[r.status] as string] ?? 'gray'}>{r.status}</HrStatusPill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <Modal open={open} onOpenChange={setOpen} title="New payroll run" size="md">
        <div className="space-y-4">
          <Field label="Company" required>
            <select
              className="w-full rounded-xl border border-border-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/30"
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
                className="w-full rounded-xl border border-border-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/30"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Year" required>
              <Input type="number" min={2020} max={2099} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={!companyId || !year || year < 2020 || year > 2099} onClick={submit}>Create run</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
