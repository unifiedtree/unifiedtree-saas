import { HrStatCard } from '@unifiedtree/design-sync-entry'
import { AlertTriangle, BadgeCheck, CalendarDays, Clock, HandCoins, Users, Wallet } from 'lucide-react'

// The KPI strip at the top of a list screen (Advance.tsx shape): four tiles,
// one accent each, ₹ values formatted the Indian way.
export function KpiRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <HrStatCard icon={<HandCoins size={18} />} color="blue" value={128} label="Total requests" />
      <HrStatCard icon={<Clock size={18} />} color="orange" value={14} label="Pending" />
      <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={97} label="Approved" />
      <HrStatCard icon={<Wallet size={18} />} color="teal" value="₹2,40,000" label="Outstanding" />
    </div>
  )
}

// Trend chip (up = emerald, down = rose) plus the optional sub line.
export function WithTrend() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <HrStatCard
        icon={<Users size={18} />}
        color="green"
        value={412}
        label="Active headcount"
        trend={{ dir: 'up', value: '3.2%' }}
        sub="vs last month"
      />
      <HrStatCard
        icon={<AlertTriangle size={18} />}
        color="red"
        value="6.8%"
        label="Attrition"
        trend={{ dir: 'down', value: '0.4%' }}
        sub="Rolling 12 months"
      />
    </div>
  )
}

// Loading pulls a skeleton in place of the value; onClick makes the tile a
// drill-down button (hover lift + pointer) instead of an inert div.
export function LoadingAndInteractive() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <HrStatCard icon={<CalendarDays size={18} />} color="purple" value={0} label="On leave today" loading />
      <HrStatCard icon={<Users size={18} />} color="blue" value={37} label="Present today" sub="Click to open the muster roll" onClick={() => {}} />
    </div>
  )
}

// All six accent colours side by side.
export function Colors() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <HrStatCard icon={<Users size={18} />} color="blue" value={37} label="Blue" />
      <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={37} label="Green" />
      <HrStatCard icon={<Clock size={18} />} color="orange" value={37} label="Orange" />
      <HrStatCard icon={<AlertTriangle size={18} />} color="red" value={37} label="Red" />
      <HrStatCard icon={<CalendarDays size={18} />} color="purple" value={37} label="Purple" />
      <HrStatCard icon={<Wallet size={18} />} color="teal" value={37} label="Teal" />
    </div>
  )
}
