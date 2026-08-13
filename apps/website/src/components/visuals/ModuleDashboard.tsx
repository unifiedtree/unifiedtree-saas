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

type Kpi = ModuleView['kpis'][number]

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

/* -------------------------------------------------------------------------- */
/* Height reservation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reserves the height of the TALLEST module for a slot whose content swaps as
 * the mock cycles.
 *
 * Every module's version of the block is rendered into one shared grid cell.
 * The copies for the inactive modules are `invisible` + `aria-hidden`, so they
 * paint nothing and are skipped by assistive tech and find-in-page, but they
 * still take part in layout — which makes the cell permanently as tall as its
 * tallest module at whatever width it happens to have. No hard-coded pixel
 * guesses, and it stays correct at every breakpoint and font fallback.
 *
 * This is what removes the hero's cycle jump. A KPI label like "Revenue being
 * processed" wraps to a second line inside the narrow stat column while "On
 * leave" does not, so the stat column — and with it the card, the hero and the
 * whole document — used to resize by 20px every 4.2s.
 */
function HeightLock({
  children,
  sizers,
  className = '',
}: {
  children: React.ReactNode
  sizers: React.ReactNode[]
  className?: string
}) {
  return (
    <div className={`grid grid-cols-1 grid-rows-1 ${className}`}>
      {sizers.map((sizer, i) => (
        <div key={i} aria-hidden className="invisible col-start-1 row-start-1 min-w-0">
          {sizer}
        </div>
      ))}
      <div className="col-start-1 row-start-1 min-w-0">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Panel visuals — every variant fills its container (`h-full`), so the caller  */
/* owns the height. That container is a fixed box, never content-sized.         */
/* -------------------------------------------------------------------------- */

function Panel({ kind }: { kind: PanelKind }) {
  if (kind === 'donut') {
    return (
      <div className="flex h-full items-center gap-6">
        <div className="relative flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-full border-[12px] border-[#047857] border-t-[#A7F3D0] border-r-[#FBBF24] border-b-[#FBBF24]">
          <div className="text-center">
            <div className="text-lg font-bold text-slate-900">₹2,71,783</div>
            <div className="text-[10px] text-slate-500">Total earnings</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium leading-tight text-slate-700">
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm bg-[#047857]" /> Benefits offered
          </div>
          <div className="flex items-center gap-2 text-sm font-medium leading-tight text-slate-700">
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm bg-[#FBBF24]" /> Variable pay
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm bg-[#A7F3D0]" />
            <div className="h-2 w-16 rounded-full bg-slate-200" />
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'roster') {
    return (
      <div className="flex h-full flex-col justify-center gap-2.5">
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
      <div className="flex h-full flex-col justify-center gap-1">
        {attendanceRows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
            <span className="min-w-0 truncate text-[13px] font-medium text-slate-800">{r.name}</span>
            <div className="flex flex-shrink-0 items-center gap-3">
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
      <div className="h-full -ml-3">
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
      <div className="flex h-full flex-col justify-center gap-5">
        {stock.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between gap-2 mb-1.5">
              <span className="min-w-0 truncate text-[12px] font-medium text-slate-700">{s.label}</span>
              <span className="flex-shrink-0 text-[12px] font-bold text-slate-900 tabular-nums">{s.pct}%</span>
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
    <div className="flex h-full flex-col justify-center gap-3">
      {pipelineStages.map((p) => (
        <div key={p.label} className="flex items-center gap-3">
          <span className="w-24 flex-shrink-0 truncate text-[12px] text-slate-600">{p.label}</span>
          <div className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-slate-100">
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

const CARD_EASE = [0.16, 1, 0.3, 1] as const

/* -------------------------------------------------------------------------- */
/* ModulePanelCard                                                             */
/* -------------------------------------------------------------------------- */

/** The stat block inside a ModulePanelCard KPI tile. */
function CardKpi({ kpi, tone }: { kpi: Kpi; tone: 'primary' | 'secondary' }) {
  return (
    <div>
      <p className="text-[11.5px] font-medium leading-snug text-white/70">{kpi.label}</p>
      <p
        className={`mt-1 font-heading font-semibold leading-tight text-white ${
          tone === 'primary' ? 'text-[21px]' : 'text-[18px]'
        }`}
      >
        {kpi.value}
      </p>
      <p className={`mt-0.5 text-[11px] leading-snug ${tone === 'primary' ? 'text-lime' : 'text-white/50'}`}>
        {kpi.sub}
      </p>
    </div>
  )
}

/** Reserved height of the card's visual well — the tallest panel's box. */
const CARD_PANEL_H = 'h-[200px]'

/**
 * ModulePanelCard — the compact, landscape sibling of ModuleDashboard.
 * Window chrome + module title + the module's two KPIs + its Panel visual,
 * laid out as stats-beside-visual so the card reads as a wide rectangle
 * (~520–620px wide, roughly 3:2) rather than a portrait slab. Same
 * MODULE_VIEWS data, same Panel renderer — a tighter crop of the product, not
 * a second mock.
 *
 * Every module-dependent slot is wrapped in HeightLock, so the card's height is
 * identical for all six modules and switching one in never nudges the page.
 */
export function ModulePanelCard({ active, className = '' }: { active: number; className?: string }) {
  const reduce = useReducedMotion()
  const view = MODULE_VIEWS[active] ?? MODULE_VIEWS[0]
  const Icon = view.icon

  return (
    <div
      className={`w-full max-w-[600px] overflow-hidden rounded-2xl border border-white/10 bg-[#04503A] shadow-2xl text-left ${className}`}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
        <img
          src="/UnifiedTreeLogo.png"
          alt="UnifiedTree"
          className="ml-2.5 h-3.5 w-auto brightness-0 invert opacity-70"
        />
      </div>

      <div className="p-4 sm:p-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view.key}
            initial={{ opacity: 0, y: reduce ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: CARD_EASE }}
          >
            {/* Module title */}
            <div className="mb-3.5 flex items-center gap-2">
              <Icon size={15} className="flex-shrink-0 text-[#A7F3D0]" />
              <h3 className="text-[15px] font-semibold leading-tight text-white">{view.title}</h3>
            </div>

            {/* Landscape body: the two stats sit BESIDE the visual, which is what
                turns the card from a portrait slab into a wide rectangle. */}
            <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] sm:gap-4">
              {/* The module's two KPIs */}
              <div className="flex h-full flex-col gap-3">
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-white/5 bg-[#047857] p-3.5 shadow-sm">
                  <HeightLock
                    sizers={MODULE_VIEWS.map((m) => (
                      <CardKpi key={m.key} kpi={m.kpis[0]} tone="primary" />
                    ))}
                  >
                    <CardKpi kpi={view.kpis[0]} tone="primary" />
                  </HeightLock>
                </div>
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-white/5 bg-[#059669]/50 p-3.5 shadow-sm">
                  <HeightLock
                    sizers={MODULE_VIEWS.map((m) => (
                      <CardKpi key={m.key} kpi={m.kpis[1]} tone="secondary" />
                    ))}
                  >
                    <CardKpi kpi={view.kpis[1]} tone="secondary" />
                  </HeightLock>
                </div>
              </div>

              {/* The module's visual, in a fixed-height well */}
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#F9FAFB] p-4 text-slate-900 shadow-sm">
                <HeightLock
                  sizers={MODULE_VIEWS.map((m) => (
                    <p key={m.key} className="text-[12.5px] font-semibold leading-snug text-slate-700">
                      {m.panelTitle}
                    </p>
                  ))}
                >
                  <p className="text-[12.5px] font-semibold leading-snug text-slate-700">{view.panelTitle}</p>
                </HeightLock>
                <div className={`mt-2.5 ${CARD_PANEL_H}`}>
                  <Panel kind={view.panel} />
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* ModuleDashboard                                                             */
/* -------------------------------------------------------------------------- */

/** The stat block inside a ModuleDashboard KPI tile. */
function DashboardKpi({ kpi, tone }: { kpi: Kpi; tone: 'primary' | 'secondary' }) {
  return (
    <div>
      <p className="text-sm text-white/70 font-medium mb-2">{kpi.label}</p>
      <p
        className={`font-heading font-semibold text-white mb-1 ${
          tone === 'primary' ? 'text-3xl' : 'text-2xl'
        }`}
      >
        {kpi.value}
      </p>
      <p className={`text-xs ${tone === 'primary' ? 'text-lime' : 'text-white/50'}`}>{kpi.sub}</p>
    </div>
  )
}

/** Reserved height of the dashboard's visual well — the tallest panel's box. */
const DASH_PANEL_H = 'h-40'

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
          <div className="flex items-center justify-between gap-4 mb-6">
            <AnimatePresence mode="wait">
              <motion.h3
                key={view.key}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                transition={{ duration: 0.25 }}
                className="text-xl font-semibold leading-7 text-white"
              >
                {view.title}
              </motion.h3>
            </AnimatePresence>
            <div className="flex flex-shrink-0 items-center gap-1.5">
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
              className="grid grid-cols-1 lg:grid-cols-3 items-stretch gap-5"
            >
              <div className="col-span-1 lg:col-span-1 flex flex-col gap-5">
                <div className="bg-[#047857] rounded-xl p-5 border border-white/5 shadow-sm">
                  <HeightLock
                    sizers={MODULE_VIEWS.map((m) => (
                      <DashboardKpi key={m.key} kpi={m.kpis[0]} tone="primary" />
                    ))}
                  >
                    <DashboardKpi kpi={view.kpis[0]} tone="primary" />
                  </HeightLock>
                </div>
                <div className="bg-[#059669]/50 rounded-xl p-5 border border-white/5 shadow-sm">
                  <HeightLock
                    sizers={MODULE_VIEWS.map((m) => (
                      <DashboardKpi key={m.key} kpi={m.kpis[1]} tone="secondary" />
                    ))}
                  >
                    <DashboardKpi kpi={view.kpis[1]} tone="secondary" />
                  </HeightLock>
                </div>
              </div>

              <div className="col-span-1 lg:col-span-2 bg-[#F9FAFB] rounded-xl p-5 border border-white/10 text-slate-900 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-center gap-3 mb-4">
                  <HeightLock
                    className="min-w-0 flex-1"
                    sizers={MODULE_VIEWS.map((m) => (
                      <p key={m.key} className="text-sm font-semibold leading-6 text-slate-700">
                        {m.panelTitle}
                      </p>
                    ))}
                  >
                    <p className="text-sm font-semibold leading-6 text-slate-700">{view.panelTitle}</p>
                  </HeightLock>
                  <div className="flex flex-shrink-0 gap-2 text-xs font-medium text-slate-500">
                    <span className="px-2 py-1 rounded-md">1w</span>
                    <span className="px-2 py-1 rounded-md bg-white shadow-sm text-slate-900">1m</span>
                    <span className="px-2 py-1 rounded-md">1y</span>
                  </div>
                </div>
                <div className={DASH_PANEL_H}>
                  <Panel kind={view.panel} />
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
