import { Button, Field, HrAvatar, HrStatusPill, Input, Modal } from '@unifiedtree/design-sync-entry'
import { AlertTriangle, Download, Mail } from 'lucide-react'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
const noop = () => {}

// The confirm step before a payroll run is processed (PayrollRunDetail.tsx
// shape): title + description from the component, a short run summary, and
// the Cancel / Confirm pair right-aligned in the footer.
export function ConfirmPayrollRun() {
  return (
    <Modal
      open
      onOpenChange={noop}
      size="sm"
      title="Process payroll run?"
      description="Payslips will be generated for every employee with an active salary structure. You can re-process until the run is locked."
    >
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] px-4 py-3 text-sm">
        <div className="flex justify-between py-1">
          <span className="text-[var(--text-tertiary)]">Period</span>
          <span className="font-medium text-[var(--text-primary)]">September 2026</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-[var(--text-tertiary)]">Company</span>
          <span className="font-medium text-[var(--text-primary)]">Meridian Technologies</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-[var(--text-tertiary)]">Employees</span>
          <span className="font-medium text-[var(--text-primary)]">148</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-[var(--text-tertiary)]">Estimated net pay</span>
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">{inr(9842600)}</span>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button>Confirm</Button>
      </div>
    </Modal>
  )
}

// The "New payroll run" form (PayrollRuns.tsx): Field + Input from the kit, a
// two-column month/year row, primary + ghost actions. size="md" is the default.
export function NewPayrollRun() {
  return (
    <Modal open onOpenChange={noop} size="md" title="New payroll run">
      <div className="space-y-4">
        <Field label="Company" required>
          <select className="ut-select" defaultValue="meridian">
            <option value="meridian">Meridian Technologies Pvt Ltd</option>
            <option value="northstar">Northstar Logistics LLP</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Month" required>
            <select className="ut-select" defaultValue="9">
              <option value="9">September</option>
              <option value="10">October</option>
            </select>
          </Field>
          <Field label="Year" required>
            <Input type="number" defaultValue={2026} />
          </Field>
        </div>
        <Field label="Pay date" hint="Salary credit date printed on every payslip.">
          <Input defaultValue="30 Sep 2026" />
        </Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost">Cancel</Button>
          <Button>Create run</Button>
        </div>
      </div>
    </Modal>
  )
}

// Reopening a locked run needs a reason: preventOutsideClose keeps an
// accidental backdrop click from discarding it, and Confirm stays disabled
// until the reason is typed.
export function ReopenForCorrections() {
  return (
    <Modal
      open
      onOpenChange={noop}
      size="sm"
      preventOutsideClose
      title="Reopen September 2026?"
      description="The run is locked. Reopening unlocks every payslip for correction and records the reason in the audit log."
    >
      <label className="block text-sm font-medium text-[var(--text-primary)]">
        Reason for reopening
        <textarea
          rows={3}
          maxLength={500}
          placeholder="Describe the payroll correction"
          className="mt-2 w-full rounded-lg border border-border-default p-3 text-sm"
        />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button disabled>Confirm</Button>
      </div>
    </Modal>
  )
}

const skipped = [
  { name: 'Rohan Das', code: 'EMP-0056', department: 'Operations' },
  { name: 'Fatima Sheikh', code: 'EMP-0198', department: 'People Ops' },
  { name: 'Karthik Iyer', code: 'EMP-0233', department: 'Sales' },
  { name: 'Ananya Bose', code: 'EMP-0241', department: 'Finance' },
  { name: 'Vikram Nair', code: 'EMP-0247', department: 'Engineering' },
]

// size="lg" (max-w-2xl): the skipped-employees list with a warning banner and
// a per-row action — wide enough for avatar, department and a button per row.
export function SkippedEmployeesLarge() {
  return (
    <Modal
      open
      onOpenChange={noop}
      size="lg"
      title="Skipped employees"
      description="Not paid in this run — no current salary structure assigned. Assign a structure and re-process to include them."
    >
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
        <p className="text-amber-800">
          <span className="font-semibold text-amber-900">5 employees were skipped.</span> Their September payslips are
          generated once a salary structure is assigned.
        </p>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {skipped.map((e) => (
          <div key={e.code} className="flex items-center justify-between py-2.5 text-sm">
            <HrAvatar name={e.name} sub={e.code} />
            <span className="text-slate-500">{e.department}</span>
            <Button size="sm" variant="outline">Assign structure</Button>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost">Close</Button>
        <Button>Re-process run</Button>
      </div>
    </Modal>
  )
}

const earnings: Array<[string, number]> = [
  ['Basic', 60000],
  ['House rent allowance', 24000],
  ['Special allowance', 18500],
  ['Conveyance', 1600],
]
const deductions: Array<[string, number]> = [
  ['Provident fund', 7200],
  ['Professional tax', 200],
  ['TDS', 9850],
]

// size="xl" (max-w-4xl): a payslip preview — employee strip, earnings and
// deductions side by side, net pay, and the download / email actions.
export function PayslipPreviewExtraLarge() {
  return (
    <Modal
      open
      onOpenChange={noop}
      size="xl"
      title="Payslip preview — September 2026"
      description="Generated from the processed run. Download or email once the run is locked."
    >
      <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] px-4 py-3">
        <HrAvatar name="Priya Raghavan" sub="EMP-0142 · Senior Engineer · Engineering" />
        <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <span>Pay date 30 Sep 2026</span>
          <HrStatusPill tone="ok">Processed</HrStatusPill>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-[var(--border-default)] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Earnings</p>
          <div className="divide-y divide-slate-100 text-sm">
            {earnings.map(([label, amount]) => (
              <div key={label} className="flex justify-between py-2">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{inr(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 font-semibold">
              <span className="text-[var(--text-primary)]">Gross</span>
              <span className="tabular-nums text-[var(--text-primary)]">{inr(104100)}</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-default)] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Deductions</p>
          <div className="divide-y divide-slate-100 text-sm">
            {deductions.map(([label, amount]) => (
              <div key={label} className="flex justify-between py-2">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{inr(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 font-semibold">
              <span className="text-[var(--text-primary)]">Total deductions</span>
              <span className="tabular-nums text-[var(--text-primary)]">{inr(17250)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-[var(--bg-subtle)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">Net pay</span>
        <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{inr(86850)}</span>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline"><Download size={16} /> Download PDF</Button>
        <Button><Mail size={16} /> Email to employee</Button>
      </div>
    </Modal>
  )
}
