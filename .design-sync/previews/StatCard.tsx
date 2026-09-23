import { StatCard } from '@unifiedtree/design-sync-entry'
import { ClipboardList, Clock, IndianRupee, Users } from 'lucide-react'

// Dashboard KPI tile (AccountsDashboard.tsx shape): uppercase label, display
// value, tinted icon bubble, and an emerald "+x% vs last month" chip.
export function PositiveChange() {
  return (
    <StatCard
      title="Active headcount"
      value={412}
      icon={Users}
      iconColor="text-emerald-600"
      iconBg="bg-emerald-50"
      change="+3.2%"
      changeType="positive"
    />
  )
}

// A metric that moved the wrong way: the chip turns rose.
export function NegativeChange() {
  return (
    <StatCard
      title="Late marks"
      value={57}
      icon={Clock}
      iconColor="text-rose-600"
      iconBg="bg-rose-50"
      change="+12.4%"
      changeType="negative"
    />
  )
}

// No movement: the chip falls back to the tertiary text colour.
export function NeutralChange() {
  return (
    <StatCard
      title="Pending approvals"
      value={14}
      icon={ClipboardList}
      iconColor="text-amber-600"
      iconBg="bg-amber-50"
      change="0.0%"
      changeType="neutral"
    />
  )
}

// Defaults only — brand icon colours (`text-brand-600` on `bg-brand-soft`),
// a ₹ display value and the optional subtitle line instead of a change chip.
export function DefaultAccentWithSubtitle() {
  return (
    <StatCard
      title="Payroll cost"
      value={'₹' + (18400000).toLocaleString('en-IN')}
      icon={IndianRupee}
      subtitle="September 2026 run · 412 employees"
    />
  )
}
