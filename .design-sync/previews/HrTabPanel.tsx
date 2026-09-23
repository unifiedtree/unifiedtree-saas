import { HrAvatar, HrButton, HrStatCard, HrStatusPill, HrTabPanel, HrTabs } from '@unifiedtree/design-sync-entry'
import type { HrTab } from '@unifiedtree/design-sync-entry'
import { Check, Clock, HandCoins, X } from 'lucide-react'

const tabs: HrTab[] = [
  { key: 'my', label: 'My Advances', badge: 3 },
  { key: 'request', label: 'Request' },
  { key: 'approvals', label: 'Approvals', badge: 2 },
]

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

// HrTabPanel is props-driven: tabKey wires role=tabpanel to the matching
// tab's aria-controls/labelledby, so it always sits under an HrTabs strip
// with the same key (Advance.tsx shape).
export function MyAdvances() {
  return (
    <div>
      <HrTabs tabs={tabs} active="my" onChange={() => {}} />
      <HrTabPanel tabKey="my">
        <div className="grid grid-cols-2 gap-3">
          <HrStatCard icon={<HandCoins size={18} />} color="blue" value={3} label="Total requests" />
          <HrStatCard icon={<Clock size={18} />} color="orange" value={1} label="Pending" />
        </div>
      </HrTabPanel>
    </div>
  )
}

// A different tab selected, and a panel with list content: pending
// requests with their status, plus the approver's actions.
export function Approvals() {
  return (
    <div>
      <HrTabs tabs={tabs} active="approvals" onChange={() => {}} />
      <HrTabPanel tabKey="approvals">
        <div className="ut-card ut-card-sm p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <HrAvatar name="Priya Raghavan" sub={inr(60000) + ' · 6 months'} />
            <HrStatusPill tone="warn">Pending</HrStatusPill>
          </div>
          <div className="flex items-center justify-between gap-3">
            <HrAvatar name="Arjun Mehta" sub={inr(25000) + ' · 3 months'} seed={1} />
            <HrStatusPill tone="warn">Pending</HrStatusPill>
          </div>
          <div className="flex items-center gap-2">
            <HrButton size="sm"><Check size={14} /> Approve</HrButton>
            <HrButton size="sm" variant="ghost"><X size={14} /> Reject</HrButton>
          </div>
        </div>
      </HrTabPanel>
    </div>
  )
}
