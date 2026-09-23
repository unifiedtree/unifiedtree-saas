import { HrAvatar, HrButton, HrDrawer, HrStatusPill } from '@unifiedtree/design-sync-entry'
import { Banknote, Check, X } from 'lucide-react'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

const requestFacts: [string, string][] = [
  ['Requested amount', inr(60000)],
  ['Monthly deduction', inr(10000)],
  ['Repayment term', '6 months'],
  ['Requested on', '18 Sep 2026'],
  ['Decision date', '—'],
  ['Disbursed on', '—'],
]

// AdvanceAdmin.tsx's advance-detail drawer: the employee and status up top,
// the request facts as a label/value grid, the reason, and the approver's
// decision in the footer. Default width (max-w-lg).
export function AdvanceDetails() {
  return (
    <HrDrawer
      title="Advance details"
      onClose={() => {}}
      footer={
        <>
          <HrButton variant="ghost"><X size={14} /> Reject</HrButton>
          <HrButton><Check size={14} /> Approve</HrButton>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <HrAvatar name="Priya Raghavan" sub="EMP-0142" />
          <HrStatusPill tone="warn">Pending approval</HrStatusPill>
        </div>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border-default bg-bg-base p-4 text-sm">
          {requestFacts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-secondary">{label}</dt>
              <dd className="mt-1 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Employee reason</h4>
          <p className="mt-2 text-sm">Medical expenses for a family member. I can repay over six months from October.</p>
        </div>
      </div>
    </HrDrawer>
  )
}

// The reject flow (AdvanceAdmin.tsx line 91): a one-line summary, an
// optional reason, and Cancel / Confirm rejection in the footer.
export function RejectAdvance() {
  return (
    <HrDrawer
      title="Reject advance"
      onClose={() => {}}
      footer={
        <>
          <HrButton variant="ghost">Cancel</HrButton>
          <HrButton>Confirm rejection</HrButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-secondary">Priya Raghavan · {inr(60000)}</p>
      <label className="text-sm font-medium">
        Reason (optional)
        <textarea className="ut-input mt-2" rows={4} defaultValue="" placeholder="Shared with the employee in the decision note." />
      </label>
    </HrDrawer>
  )
}

// A wider panel (width="max-w-3xl") without a footer: a disbursed advance
// with its recovery summary below the facts.
export function WideWithRecovery() {
  const facts: [string, string][] = [
    ['Requested amount', inr(120000)],
    ['Monthly deduction', inr(10000)],
    ['Repayment term', '12 months'],
    ['Requested on', '2 Sep 2026'],
    ['Decision date', '4 Sep 2026'],
    ['Disbursed on', '6 Sep 2026'],
  ]
  return (
    <HrDrawer title="Advance details" width="max-w-3xl" onClose={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <HrAvatar name="Sneha Kulkarni" sub="EMP-0211" seed={2} />
          <HrStatusPill tone="teal">Disbursed</HrStatusPill>
        </div>
        <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border-default bg-bg-base p-4 text-sm">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-secondary">{label}</dt>
              <dd className="mt-1 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h4 className="font-semibold text-text-primary">Salary recovery</h4>
          <p className="mt-1 text-sm text-text-secondary">Installments are recovered through payroll. Deferrals keep the total amount unchanged.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border-default p-3">
            <p className="text-xs text-text-secondary">Outstanding</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{inr(110000)}</p>
          </div>
          <div className="rounded-lg border border-border-default p-3">
            <p className="text-xs text-text-secondary">Installments remaining</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">11</p>
          </div>
          <div className="rounded-lg border border-border-default p-3">
            <p className="text-xs text-text-secondary">Next recovery</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">Nov 2026</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <HrButton variant="ghost"><Banknote size={15} /> Record full repayment</HrButton>
          <HrButton variant="ghost">Write off balance</HrButton>
        </div>
      </div>
    </HrDrawer>
  )
}
