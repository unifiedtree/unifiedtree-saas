import { Button, Drawer, Field, HrAvatar, HrStatusPill, Input } from '@unifiedtree/design-sync-entry'
import { Download } from 'lucide-react'
import type { ReactNode } from 'react'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
const noop = () => {}

const earnings: Array<[string, number]> = [
  ['Basic', 60000],
  ['House rent allowance', 24000],
  ['Special allowance', 18500],
]
const deductions: Array<[string, number]> = [
  ['Provident fund', 7200],
  ['Professional tax', 200],
  ['TDS', 9850],
]

// PayrollRunDetail.tsx's payslip drawer: clicking a row in the run opens the
// employee's slip in the right-hand panel — identity strip, period facts,
// earnings / deductions and the net figure, with a download action.
export function PayslipDetail() {
  return (
    <Drawer open onOpenChange={noop} title="Payslip">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <HrAvatar name="Priya Raghavan" sub="EMP-0142 · Engineering" />
          <HrStatusPill tone="ok">Processed</HrStatusPill>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Period</p>
            <p className="font-medium text-[var(--text-primary)]">September 2026</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Pay date</p>
            <p className="font-medium text-[var(--text-primary)]">30 Sep 2026</p>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Earnings</p>
          <div className="divide-y divide-slate-100 text-sm">
            {earnings.map(([label, amount]) => (
              <div key={label} className="flex justify-between py-2">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{inr(amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Deductions</p>
          <div className="divide-y divide-slate-100 text-sm">
            {deductions.map(([label, amount]) => (
              <div key={label} className="flex justify-between py-2">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{inr(amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-[var(--bg-subtle)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Net pay</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{inr(85250)}</span>
        </div>
        <Button variant="outline" className="w-full"><Download size={16} /> Download PDF</Button>
      </div>
    </Drawer>
  )
}

// The onboarding "Edit template" drawer (TemplateDetail.tsx): a Field/Input
// form with a textarea, two selects, an Active toggle and the save / cancel
// pair above a top rule.
export function EditOnboardingTemplate() {
  return (
    <Drawer open onOpenChange={noop} title="Edit template">
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="Template name" required>
          <Input defaultValue="Engineering new-hire (Bengaluru)" />
        </Field>
        <Field label="Description">
          <textarea
            rows={3}
            defaultValue="Laptop, access provisioning, buddy assignment and the 30-day check-in for engineering hires."
            className="w-full rounded-lg border border-border-default p-3 text-sm text-text-primary"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department">
            <select className="ut-select" defaultValue="eng">
              <option value="eng">Engineering</option>
              <option value="ops">Operations</option>
            </select>
          </Field>
          <Field label="Designation">
            <select className="ut-select" defaultValue="se">
              <option value="se">Software Engineer</option>
              <option value="sse">Senior Engineer</option>
            </select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" defaultChecked className="accent-[#059669]" />
          <span className="text-sm text-text-primary">Active</span>
        </label>
        <div className="flex gap-2 border-t border-border-default pt-4">
          <Button type="submit" size="sm">Save changes</Button>
          <Button type="button" size="sm" variant="ghost">Cancel</Button>
        </div>
      </form>
    </Drawer>
  )
}

const eventFields: Array<{ label: string; value: ReactNode }> = [
  { label: 'Event ID', value: <span className="hr-mono">evt_01J8K2M4Q7X9</span> },
  { label: 'Timestamp', value: '18 Sep 2026, 14:32' },
  { label: 'Actor', value: 'hr.admin@meridian.in' },
  { label: 'Action', value: <HrStatusPill tone="ok">LEAVE_APPROVED</HrStatusPill> },
  { label: 'Resource', value: 'LeaveRequest' },
  { label: 'Resource ID', value: <span className="hr-mono">lr_0a91f3c2</span> },
  { label: 'Employee', value: 'Sneha Kulkarni · EMP-0211' },
  { label: 'IP address', value: '103.21.58.14' },
]

// The audit-log event drawer (AuditLogs.tsx): a label / value stack with the
// action rendered as a status pill and identifiers in the mono style.
export function AuditEventDetails() {
  return (
    <Drawer open onOpenChange={noop} title="Event Details">
      <div className="space-y-4">
        {eventFields.map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{label}</span>
            <span className="text-sm text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </Drawer>
  )
}
