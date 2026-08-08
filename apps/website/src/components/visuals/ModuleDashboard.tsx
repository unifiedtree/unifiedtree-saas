import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  LayoutDashboard, Users, Fingerprint, Calculator, Boxes, Contact,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

/**
 * The product mock used across the marketing site — a real, switchable
 * dashboard rather than a frozen screenshot. Each module has its own KPIs and
 * its own visualisation, so the picture actually argues the "one platform,
 * every module" point instead of just decorating the page.
 */

const revenueData = [
  { month: 'Jul', revenue: 14.2 }, { month: 'Aug', revenue: 16.8 },
  { month: 'Sep', revenue: 15.1 }, { month: 'Oct', revenue: 18.4 },
  { month: 'Nov', revenue: 21.3 }, { month: 'Dec', revenue: 19.7 },
  { month: 'Jan', revenue: 22.9 }, { month: 'Feb', revenue: 24.6 },
]

const attendanceRows = [
  { name: 'Priya Sharma', status: 'Present', time: '09:02 AM' },
  { name: 'Arjun Mehta', status: 'Present', time: '08:58 AM' },
  { name: 'Kavya Nair', status: 'On Leave', time: '—' },
  { name: 'Rohit Gupta', status: 'Absent', time: '—' },
]

const statusColors: Record<string, string> = {
  Present: 'bg-emerald-100 text-emerald-700',
  Absent: 'bg-red-100 text-red-600',
  'On Leave': 'bg-amber-100 text-amber-700',
}

const avatarColors = ['#059669', '#10B981', '#047857', '#04503A', '#525252']

const roster = [
  { name: 'Priya Sharma', role: 'Design Lead', dept: 'Product' },
  { name: 'Arjun Mehta', role: 'Sr. Accountant', dept: 'Finance' },
  { name: 'Kavya Nair', role: 'Plant Supervisor', dept: 'Operations' },
  { name: 'Rohit Gupta', role: 'Sales Executive', dept: 'Revenue' },
]

const stock = [
  { label: 'Warehouse — Hyderabad', pct: 82 },
  { label: 'Warehouse — Pune', pct: 61 },
  { label: 'Retail counter', pct: 38 },
]

const pipelineStages = [
  { label: 'Qualified', count: 18, pct: 100 },
  { label: 'Proposal sent', count: 12, pct: 68 },
  { label: 'Negotiation', count: 7, pct: 42 },
  { label: 'Closing', count: 4, pct: 24 },
]

type PanelKind = 'donut' | 'roster' | 'attendance' | 'area' | 'bars' | 'pipeline'

export interface ModuleView {
  key: string
  label: string
  icon: React.ElementType
  title: string
  blurb: string
  kpis: { label: string; value: string; sub: string }[]
  panel: PanelKind
  panelTitle: string
}

export const MODULE_VIEWS: ModuleView[] = [
  {
    key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, title: 'Dashboard',
    blurb: 'Every module reporting into one place — no tab-hopping, no exports.',
    kpis: [
      { label: 'Revenue being processed', value: '₹24,60,000', sub: 'Last 1 month period' },
      { label: 'Platform fees', value: '₹12,450', sub: 'Last 1 month period' },
    ],
    panel: 'donut', panelTitle: 'Earnings mix',
  },
  {
    key: 'hr', label: 'HR', icon: Users, title: 'People',
    blurb: 'Records, onboarding and org structure that stay correct on their own.',
    kpis: [
      { label: 'Total headcount', value: '248', sub: '+12 this quarter' },
      { label: 'Open positions', value: '9', sub: '3 in final round' },
    ],
    panel: 'roster', panelTitle: 'Recently onboarded',
  },
  {
    key: 'attendance', label: 'Attendance', icon: Fingerprint, title: 'Attendance',
    blurb: 'Face capture that works offline and syncs the moment you reconnect.',
    kpis: [
      { label: 'Present today', value: '231', sub: '93% of workforce' },
      { label: 'On leave', value: '11', sub: '6 approved · 5 pending' },
    ],
    panel: 'attendance', panelTitle: "Today's log",
  },
  {
    key: 'accounting', label: 'Accounting', icon: Calculator, title: 'Accounting',
    blurb: 'Tax-compliant invoicing and filings, generated from the same ledger.',
    kpis: [
      { label: 'Revenue this FY', value: '₹1.62 Cr', sub: '+18% year on year' },
      { label: 'Outstanding', value: '₹4,20,000', sub: '14 invoices overdue' },
    ],
    panel: 'area', panelTitle: 'Revenue trend',
  },
  {
    key: 'inventory', label: 'Inventory', icon: Boxes, title: 'Inventory',
    blurb: 'Multi-warehouse stock with batch tracking and reorder signals.',
    kpis: [
      { label: 'SKUs in stock', value: '1,284', sub: 'across 3 locations' },
      { label: 'Low stock', value: '23', sub: 'reorder suggested' },
    ],
    panel: 'bars', panelTitle: 'Capacity by location',
  },
  {
    key: 'crm', label: 'CRM', icon: Contact, title: 'CRM',
    blurb: 'Leads to invoice in one thread — sales hands nothing over manually.',
    kpis: [
      { label: 'Pipeline value', value: '₹92,40,000', sub: '48 open deals' },
      { label: 'Won this month', value: '₹14,80,000', sub: '11 deals closed' },
    ],
    panel: 'pipeline', panelTitle: 'Deal stages',
  },
]

const SWITCH_MS = 4200

function Panel({ kind }: { kind: PanelKind }) {
  if (kind === 'donut') {
    return (
      <div className="flex items-center gap-8 h-40">
        <div className="relative w-32 h-32 rounded-full border-[12px] border-[#047857] border-t-[#A7F3D0] border-r-[#FBBF24] border-b-[#FBBF24] flex items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-bold text-slate-900">₹2,71,783</div>
            <div className="text-[10px] text-slate-500">Total earnings</div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700 font-medium">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#047857]" /> Benefits offered
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-700 font-medium">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#FBBF24]" /> Variable pay
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm bg-[#A7F3D0]" />
            <div className="w-16 h-2 bg-slate-200 rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'roster') {
    return (
      <div className="h-40 flex flex-col justify-center gap-2.5">
        {roster.map((p, i) => (
          <div key={p.name} className="flex items-center gap-3">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: avatarColors[i % avatarColors.length] }}
            >
              {p.name.split(' ').map((n) => n[0]).join('')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800 truncate">{p.name}</p>
              <p className="text-[11px] text-slate-500 truncate">{p.role}</p>
            </div>
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex-shrink-0">
              {p.dept}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'attendance') {
    return (
      <div className="h-40 flex flex-col justify-center gap-1">
        {attendanceRows.map((r) => (
          <div key={r.name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
            <span className="text-[13px] font-medium text-slate-800">{r.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 tabular-nums">{r.time}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColors[r.status]}`}>
                {r.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'area') {
    return (
      <div className="h-40 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={revenueData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mdRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: '#A7F3D0' }}
              contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E5E5' }}
              formatter={(v) => [`₹${v} L`, 'Revenue']}
            />
            <Area type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2.5} fill="url(#mdRev)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (kind === 'bars') {
    return (
      <div className="h-40 flex flex-col justify-center gap-5">
        {stock.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between mb-1.5">
              <span className="text-[12px] font-medium text-slate-700">{s.label}</span>
              <span className="text-[12px] font-bold text-slate-900 tabular-nums">{s.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-[#059669]"
                initial={{ width: 0 }} animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="h-40 flex flex-col justify-center gap-3">
      {pipelineStages.map((p) => (
        <div key={p.label} className="flex items-center gap-3">
          <span className="text-[12px] text-slate-600 w-24 flex-shrink-0">{p.label}</span>
          <div className="flex-1 h-6 rounded-md bg-slate-100 overflow-hidden">
            <motion.div
              className="h-full rounded-md bg-[#059669]/85 flex items-center justify-end pr-2"
              initial={{ width: 0 }} animate={{ width: `${p.pct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              <span className="text-[10px] font-bold text-white">{p.count}</span>
            </motion.div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface Props {
  /** Controlled active index. Omit to let the component self-cycle. */
  active?: number
  onActiveChange?: (i: number) => void
  autoCycle?: boolean
  className?: string
}

export function ModuleDashboard({ active, onActiveChange, autoCycle = true, className = '' }: Props) {
  const reduce = useReducedMotion()
  const [internal, setInternal] = useState(0)
  const [paused, setPaused] = useState(false)
  const controlled = active !== undefined
  const idx = controlled ? active : internal

  const set = (i: number) => {
    if (!controlled) setInternal(i)
    onActiveChange?.(i)
  }

  useEffect(() => {
    if (controlled || !autoCycle || reduce || paused) return
    const id = setInterval(() => setInternal((i) => (i + 1) % MODULE_VIEWS.length), SWITCH_MS)
    return () => clearInterval(id)
  }, [controlled, autoCycle, reduce, paused])

  const view = MODULE_VIEWS[idx]

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/10 bg-[#04503A] shadow-2xl text-left ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5">
        <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
        <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
        <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
        <span className="ml-3 flex items-center gap-2">
          <img src="/UnifiedTreeLogo.png" alt="UnifiedTree" className="h-4 w-auto brightness-0 invert opacity-70" />
        </span>
      </div>

      <div className="flex bg-[#065F46]">
        {/* Module rail */}
        <div className="w-40 border-r border-white/10 p-4 flex-shrink-0 hidden md:block">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Main Menu</div>
          {MODULE_VIEWS.map((m, i) => {
            const Icon = m.icon
            const on = i === idx
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => set(i)}
                aria-current={on || undefined}
                className={`relative w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${
                  on ? 'text-white' : 'text-white/55 hover:text-white hover:bg-white/5'
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="mdNavPill"
                    className="absolute inset-0 rounded-lg bg-white/12"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon size={14} className="relative z-10 flex-shrink-0" />
                <span className="relative z-10">{m.label}</span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 min-w-0 bg-[#04503A]">
          <div className="flex items-center justify-between mb-6">
            <AnimatePresence mode="wait">
              <motion.h3
                key={view.key}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                transition={{ duration: 0.25 }}
                className="text-xl font-semibold text-white"
              >
                {view.title}
              </motion.h3>
            </AnimatePresence>
            <div className="flex items-center gap-1.5">
              {MODULE_VIEWS.map((m, i) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => set(i)}
                  aria-label={`Show ${m.label}`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === idx ? 'w-5 bg-[#A7F3D0]' : 'w-1.5 bg-white/25 hover:bg-white/45'
                  }`}
                />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={view.key}
              initial={{ opacity: 0, y: reduce ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-5"
            >
              <div className="col-span-1 lg:col-span-1 space-y-5">
                <div className="bg-[#047857] rounded-xl p-5 border border-white/5 shadow-sm">
                  <p className="text-sm text-white/70 font-medium mb-2">{view.kpis[0].label}</p>
                  <p className="text-3xl font-heading font-semibold text-white mb-1">{view.kpis[0].value}</p>
                  <p className="text-xs text-lime">{view.kpis[0].sub}</p>
                </div>
                <div className="bg-[#059669]/50 rounded-xl p-5 border border-white/5 shadow-sm">
                  <p className="text-sm text-white/70 font-medium mb-2">{view.kpis[1].label}</p>
                  <p className="text-2xl font-heading font-semibold text-white mb-1">{view.kpis[1].value}</p>
                  <p className="text-xs text-white/50">{view.kpis[1].sub}</p>
                </div>
              </div>

              <div className="col-span-1 lg:col-span-2 bg-[#F9FAFB] rounded-xl p-5 border border-white/10 text-slate-900 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm font-semibold text-slate-700">{view.panelTitle}</p>
                  <div className="flex gap-2 text-xs font-medium text-slate-500">
                    <span className="px-2 py-1 rounded-md">1w</span>
                    <span className="px-2 py-1 rounded-md bg-white shadow-sm text-slate-900">1m</span>
                    <span className="px-2 py-1 rounded-md">1y</span>
                  </div>
                </div>
                <Panel kind={view.panel} />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
