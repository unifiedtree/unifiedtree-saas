import React, { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Button, Field, Input, Badge, DataTable, type Column } from '@unifiedtree/ui-kit'
import { Can, P } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  usePayrollSettings, useUpdatePayrollSettings, usePtSlabs,
  type PayrollSettings as Settings, type PtSlab,
} from '../api/usePayroll'

const PT_STATES = [
  { code: '', name: 'Select state' },
  { code: 'KA', name: 'Karnataka' }, { code: 'MH', name: 'Maharashtra' },
  { code: 'TN', name: 'Tamil Nadu' }, { code: 'TS', name: 'Telangana' },
  { code: 'AP', name: 'Andhra Pradesh' }, { code: 'WB', name: 'West Bengal' },
  { code: 'GJ', name: 'Gujarat' }, { code: 'KL', name: 'Kerala' },
]

const slabColumns: Column<PtSlab>[] = [
  { key: 'range', header: 'Monthly salary', cell: (r) => `₹${r.minSalary.toLocaleString('en-IN')}${r.maxSalary ? ` – ₹${r.maxSalary.toLocaleString('en-IN')}` : '+'}` },
  { key: 'tax', header: 'PT / month', cell: (r) => `₹${r.monthlyTax.toLocaleString('en-IN')}` },
]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', on ? 'bg-[#0F6E56]' : 'bg-slate-300')}>
      <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: on ? 'translateX(18px)' : 'translateX(4px)' }} />
    </button>
  )
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
    <h2 className="text-sm font-bold text-slate-800">{title}</h2>
    {children}
  </div>
)

export const PayrollSettings: React.FC = () => {
  const { toast } = useToast()
  const { data } = usePayrollSettings()
  const update = useUpdatePayrollSettings()

  const [s, setS] = useState<Partial<Settings>>({})
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (data) { setS(data); setDirty(false) } }, [data])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS(p => ({ ...p, [k]: v })); setDirty(true) }
  const { data: slabs = [] } = usePtSlabs(s.ptEnabled ? s.ptStateCode ?? undefined : undefined)

  const save = () => {
    update.mutate(s, {
      onSuccess: () => { toast('Payroll settings saved', 'success'); setDirty(false) },
      onError: (e) => toast((e as Error).message, 'error'),
    })
  }

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">Payroll Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Statutory deductions and payroll cycle. No calculations run yet — this is configuration only.</p>
      </div>

      <Card title="Provident Fund (PF)">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Enable PF</span>
          <Toggle on={!!s.pfEnabled} onChange={(v) => set('pfEnabled', v)} />
        </label>
        {s.pfEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee %"><Input type="number" step="0.001" value={s.pfEmployeePercent ?? 12} onChange={(e) => set('pfEmployeePercent', Number(e.target.value))} /></Field>
            <Field label="Employer %"><Input type="number" step="0.001" value={s.pfEmployerPercent ?? 12} onChange={(e) => set('pfEmployerPercent', Number(e.target.value))} /></Field>
            <Field label="Wage ceiling (₹)"><Input type="number" value={s.pfWageCeiling ?? 15000} onChange={(e) => set('pfWageCeiling', Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 mt-7 text-sm text-slate-700">
              <Toggle on={!!s.pfApplyCeiling} onChange={(v) => set('pfApplyCeiling', v)} /> Apply ceiling
            </label>
          </div>
        )}
      </Card>

      <Card title="ESI">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Enable ESI</span>
          <Toggle on={!!s.esiEnabled} onChange={(v) => set('esiEnabled', v)} />
        </label>
        {s.esiEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee %"><Input type="number" step="0.001" value={s.esiEmployeePercent ?? 0.75} onChange={(e) => set('esiEmployeePercent', Number(e.target.value))} /></Field>
            <Field label="Employer %"><Input type="number" step="0.001" value={s.esiEmployerPercent ?? 3.25} onChange={(e) => set('esiEmployerPercent', Number(e.target.value))} /></Field>
            <Field label="Wage ceiling (₹)"><Input type="number" value={s.esiWageCeiling ?? 21000} onChange={(e) => set('esiWageCeiling', Number(e.target.value))} /></Field>
          </div>
        )}
      </Card>

      <Card title="Professional Tax (PT)">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Enable PT</span>
          <Toggle on={!!s.ptEnabled} onChange={(v) => set('ptEnabled', v)} />
        </label>
        {s.ptEnabled && (
          <>
            <Field label="State">
              <select value={s.ptStateCode ?? ''} onChange={(e) => set('ptStateCode', e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0F6E56]">
                {PT_STATES.map(st => <option key={st.code} value={st.code}>{st.name}</option>)}
              </select>
            </Field>
            {s.ptStateCode && slabs.length > 0 && (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <DataTable columns={slabColumns} data={slabs} getRowKey={(r) => r.id} />
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Labour Welfare Fund (LWF)">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Enable LWF</span>
          <Toggle on={!!s.lwfEnabled} onChange={(v) => set('lwfEnabled', v)} />
        </label>
        {s.lwfEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee amount (₹)"><Input type="number" value={s.lwfEmployeeAmount ?? 0} onChange={(e) => set('lwfEmployeeAmount', Number(e.target.value))} /></Field>
            <Field label="Employer amount (₹)"><Input type="number" value={s.lwfEmployerAmount ?? 0} onChange={(e) => set('lwfEmployerAmount', Number(e.target.value))} /></Field>
          </div>
        )}
      </Card>

      <Card title="Payroll Cycle & LOP">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Cycle start day"><Input type="number" min={1} max={31} value={s.payrollCycleStartDay ?? 1} onChange={(e) => set('payrollCycleStartDay', Number(e.target.value))} /></Field>
          <Field label="Cycle end day"><Input type="number" min={1} max={31} value={s.payrollCycleEndDay ?? 31} onChange={(e) => set('payrollCycleEndDay', Number(e.target.value))} /></Field>
          <Field label="Processing day"><Input type="number" min={1} max={31} value={s.salaryProcessingDay ?? 28} onChange={(e) => set('salaryProcessingDay', Number(e.target.value))} /></Field>
        </div>
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Sandwich rule <span className="text-xs text-slate-400">(weekend between LOP days becomes LOP)</span></span>
          <Toggle on={!!s.sandwichRuleEnabled} onChange={(v) => set('sandwichRuleEnabled', v)} />
        </label>
        <Field label="Late-mark LOP threshold" hint="Every N late marks = 1 LOP day. Leave blank to disable.">
          <Input type="number" min={1} value={s.lateMarkLopThreshold ?? ''} onChange={(e) => set('lateMarkLopThreshold', e.target.value ? Number(e.target.value) : null as any)} className="max-w-[140px]" />
        </Field>
      </Card>

      <Can code={P.PAYROLL_SETTINGS_UPDATE}>
        <Button loading={update.isPending} disabled={!dirty} onClick={save}>Save settings</Button>
      </Can>
    </div>
  )
}
