import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'
import {
  ArrowRight, Lock, Search, Sparkles, Users,
  type LucideIcon,
} from 'lucide-react'
import { APPS } from '@/layouts/appConfig'
import { useModulePlans, iconMap, type ModulePlan } from '@/core/api/modulePlans'
import { useDisplayName } from '@/shared/hooks/useDisplayName'

type Status = 'active' | 'coming-soon' | 'locked'

/** A single tile in the launcher grid. Built from a ModulePlan fetched
 *  from the backend (merged sellable-plans view). Keeps the render code
 *  shape-agnostic. */
interface Tile {
  key: string                          // stable react key + click identifier
  planKey?: string                     // module_plans.key when this is a plan tile
  label: string
  description: string
  icon: LucideIcon
  status: Status
  home: string                         // route when opened (active tiles only)
  sortOrder: number                    // preserved from module_plans.sort_order
}

/**
 * Convert a backend ModulePlan row into a launcher tile.
 *   status = 'coming-soon' when plan.status === 'LAUNCHING_SOON'
 *          = 'active'      when plan.status === 'AVAILABLE' AND the tenant
 *                          has at least one of plan.includedModules active
 *          = 'locked'      otherwise
 *   home   = first APPS.home for an includedModule with built=true, fallback /dashboard
 *
 * Ordering uses the DB's sort_order verbatim so the launcher matches
 * /pricing exactly — HR/Attendance/Payroll (sort_order=1) at the top,
 * launching-soon modules in DB order below. Not re-ranking by status:
 * that put HR (locked, rank 2) BELOW all the launching-soon tiles
 * (rank 1) on a fresh workspace, which the client flagged as wrong on
 * 2026-08-07 ("HR is at the last, keep it at the top").
 */
function planToTile(plan: ModulePlan, activeModules: string[]): Tile {
  const Icon = (plan.icon && iconMap[plan.icon]) || Users
  const anyActive = plan.includedModules.some(mk => activeModules.includes(mk))
  const primaryApp = plan.includedModules
    .map(mk => APPS.find(a => a.key === mk && a.built))
    .find(Boolean)
  const status: Status = plan.status === 'LAUNCHING_SOON'
    ? 'coming-soon'
    : plan.status === 'AVAILABLE' && anyActive
      ? (primaryApp ? 'active' : 'coming-soon')
      : 'locked'
  return {
    key: plan.key,
    planKey: plan.key,
    label: plan.displayName,
    description: plan.tagline || plan.description || '',
    icon: Icon,
    status,
    home: primaryApp?.home ?? '/dashboard',
    sortOrder: plan.sortOrder ?? 999,
  }
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']

/**
 * Per-app icon identities — the Odoo move: every app instantly recognisable by
 * colour. Deliberately NOT the emerald brand ramp (client call 2026-08-11:
 * launcher icons are colourful; brand emerald stays in the frame around them).
 * Keyed by module_plans.key with an ordered fallback rotation for new plans.
 */
/* Solid saturated tile + WHITE glyph — pastel tiles with thin coloured icons
   washed out completely on the vivid green field. Each app gets a two-stop
   gradient plus a glow shadow in its own hue, so tiles read at a glance and
   the grid feels like Odoo's confetti of app identities. */
const TILE_COLORS: Record<string, { from: string; to: string; glow: string }> = {
  'hr-employees':        { from: '#34D399', to: '#059669', glow: 'rgba(5,150,105,0.45)' },
  hrms:                  { from: '#34D399', to: '#059669', glow: 'rgba(5,150,105,0.45)' },
  crm:                   { from: '#818CF8', to: '#4F46E5', glow: 'rgba(79,70,229,0.45)' },
  'crm-sales-pos':       { from: '#818CF8', to: '#4F46E5', glow: 'rgba(79,70,229,0.45)' },
  scm:                   { from: '#22D3EE', to: '#0E7490', glow: 'rgba(14,116,144,0.45)' },
  marketing:             { from: '#F472B6', to: '#DB2777', glow: 'rgba(219,39,119,0.45)' },
  procurement:           { from: '#FB923C', to: '#EA580C', glow: 'rgba(234,88,12,0.45)' },
  'inventory-warehouse': { from: '#A3E635', to: '#4D7C0F', glow: 'rgba(77,124,15,0.45)' },
  inventory:             { from: '#A3E635', to: '#4D7C0F', glow: 'rgba(77,124,15,0.45)' },
  projects:              { from: '#60A5FA', to: '#2563EB', glow: 'rgba(37,99,235,0.45)' },
  'project-management':  { from: '#60A5FA', to: '#2563EB', glow: 'rgba(37,99,235,0.45)' },
  accounting:            { from: '#FBBF24', to: '#D97706', glow: 'rgba(217,119,6,0.45)' },
  manufacturing:         { from: '#A78BFA', to: '#7C3AED', glow: 'rgba(124,58,237,0.45)' },
  reports:               { from: '#38BDF8', to: '#0369A1', glow: 'rgba(3,105,161,0.45)' },
  'reports-bi':          { from: '#38BDF8', to: '#0369A1', glow: 'rgba(3,105,161,0.45)' },
}
const FALLBACK_COLORS = [
  { from: '#818CF8', to: '#4F46E5', glow: 'rgba(79,70,229,0.45)' },
  { from: '#FB923C', to: '#EA580C', glow: 'rgba(234,88,12,0.45)' },
  { from: '#38BDF8', to: '#0369A1', glow: 'rgba(3,105,161,0.45)' },
  { from: '#F472B6', to: '#DB2777', glow: 'rgba(219,39,119,0.45)' },
  { from: '#A78BFA', to: '#7C3AED', glow: 'rgba(124,58,237,0.45)' },
  { from: '#FBBF24', to: '#D97706', glow: 'rgba(217,119,6,0.45)' },
]
function tileColor(key: string, index: number) {
  return TILE_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

export const Modules: React.FC = () => {
  const navigate = useNavigate()
  const activeModules = useLocalAuthStore(s => s.tenant?.activeModules ?? [])
  const user          = useSdkStore(s => s.user)
  const permissions   = useSdkStore(s => s.permissions)
  const roles: string[] = user?.roles ?? []
  const isAdmin = roles.some(r => ADMIN_ROLES.includes(r)) || permissions.has('*')

  // Backend-driven merged view — same source as the marketing site's
  // /pricing and Navbar mega-menu (platform.module_plans, RETIRED-filtered).
  const { data: plans = [], isLoading: plansLoading } = useModulePlans()

  const [query, setQuery] = useState('')

  /** Open the IN-WORKSPACE plan configurator. Client-decision 2026-08-07:
   *  Manage Plan must stay inside the workspace — the old external redirect
   *  to unifiedtree.com/edit-workspace was confusing and marketing-branded. */
  const openPlan = (planKey?: string) => {
    navigate(planKey ? `/plan?add=${encodeURIComponent(planKey)}` : '/plan')
  }

  // Tile grid = merged sellable plans only (RETIRED-filtered) — no Settings
  // pseudo-tile (client feedback: real modules only; Settings lives in the
  // shell header). DB sort_order preserved (matches /pricing; HR first).
  const tiles = useMemo<Tile[]>(() => {
    const list = plans
      .filter(p => p.status !== 'RETIRED')
      .map(p => planToTile(p, activeModules))
    const q = query.trim().toLowerCase()
    const filtered = q
      ? list.filter(t => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      : list
    return filtered.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  }, [plans, query, activeModules])

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()
  // Centralised fallback chain: displayName > firstName + lastName > firstName
  // > email.split('@')[0]. Was inlined here as `user?.firstName || email
  // local-part`, which meant customers whose `firstName` hydrated a beat late
  // (fresh login on a cold tab) got "shurya.kumar063" flashed before
  // "Suryakumar" settled. See useDisplayName for the full rationale.
  const { greetingName: firstName } = useDisplayName()

  const enter = (tile: Tile) => {
    if (tile.status === 'locked') { if (isAdmin) openPlan(tile.planKey); return }
    if (tile.status === 'coming-soon') return  // no-op — the "Soon" chip is the whole message
    navigate(tile.home)
  }

  return (
    /* The Odoo launcher stance: apps floating on a rich field — ours is the
       client's "Green Apple" blend: vivid #16A34A/#059669 up top (behind the
       transparent shell header) sliding through teal #0D9488 into deep
       #065F46. Stops are px-anchored so tile labels always sit on ground
       darker than #047857 (≥ 5:1 with white) on any viewport height; the
       heading zone stays brighter (large-text AA). Pure colour fields only. */
    <div
      className="relative min-h-full overflow-hidden"
      style={{
        backgroundColor: '#065F46',
        backgroundImage: [
          'radial-gradient(46% 320px at 10% -40px, rgba(74,222,128,0.32), transparent 70%)',
          'radial-gradient(40% 300px at 92% 20px, rgba(45,212,191,0.26), transparent 70%)',
          'radial-gradient(90% 55% at 50% 108%, rgba(2,41,30,0.5), transparent 72%)',
          'linear-gradient(172deg, #16A34A 0px, #059669 150px, #0D9488 290px, #047857 430px, #065F46 760px)',
        ].join(', '),
      }}
    >
      {/* pt clears the shell's transparent 64px launcher header overlay */}
      <div className="relative mx-auto max-w-5xl px-6 pb-10 pt-20 sm:px-8 sm:pb-14 sm:pt-24">
        {/* Header */}
        <div className="animate-fade-up mb-10 flex flex-col items-center gap-5 text-center">
          <div>
            {/* pill ground keeps the mint greeting ≥ 4.5:1 on the vivid top band */}
            <p className="inline-flex items-center rounded-full bg-[#04503A]/60 px-3 py-1 text-sm font-medium text-[#A7F3D0] backdrop-blur-sm">{greeting}, {firstName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Choose an app</h1>
          </div>
          <div className="flex w-full max-w-md items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search apps…"
                className="h-10 w-full rounded-lg border border-white/20 bg-[#04503A]/50 pl-9 pr-3 text-sm text-white placeholder:text-white/55 shadow-xs outline-none backdrop-blur-sm transition-[border-color,box-shadow] focus:border-[#A7F3D0]/60 focus:ring-4 focus:ring-[#A7F3D0]/15"
              />
            </div>
            {isAdmin && (
              <button
                onClick={() => openPlan()}
                className="hidden h-10 shrink-0 items-center gap-1.5 rounded-lg border border-white/20 bg-[#04503A]/50 px-3.5 text-sm font-medium text-white shadow-xs backdrop-blur-sm transition-colors hover:bg-[#04503A]/70 sm:inline-flex"
              >
                Manage plan <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>

        {/* App grid — Odoo-style icon tiles: coloured squircle, label beneath */}
        {plansLoading && tiles.length === 0 ? (
          <div className="mx-auto grid max-w-3xl grid-cols-3 gap-x-6 gap-y-10 sm:grid-cols-4 md:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <div className="h-20 w-20 animate-pulse rounded-2xl bg-white/10" />
                <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl grid-cols-3 gap-x-6 gap-y-10 sm:grid-cols-4 md:grid-cols-5">
            {tiles.map((tile, i) => {
              const { status } = tile
              const locked = status === 'locked'
              const soon = status === 'coming-soon'
              const Icon = tile.icon
              const color = tileColor(tile.key, i)
              return (
                <motion.button
                  key={tile.key}
                  onClick={() => enter(tile)}
                  disabled={locked && !isAdmin}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.035, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={locked && !isAdmin ? undefined : { y: -4 }}
                  whileTap={locked && !isAdmin ? undefined : { scale: 0.96 }}
                  className={clsx(
                    'group flex flex-col items-center gap-3 focus-visible:outline-none',
                    locked && !isAdmin && 'cursor-default',
                  )}
                  title={tile.description}
                >
                  <span className="relative">
                    <span
                      className={clsx(
                        'flex h-20 w-20 items-center justify-center rounded-[22px] text-white transition-all duration-200',
                        // "Soon" keeps its full colour — the badge carries the message.
                        // Only LOCKED goes grey, and even then stays legible.
                        !locked && 'group-hover:brightness-110',
                      )}
                      style={
                        locked
                          ? {
                              background: 'linear-gradient(160deg, #9CA3AF 0%, #6B7280 100%)',
                              boxShadow: '0 10px 26px -10px rgba(1,22,16,0.5)',
                            }
                          : {
                              background: `linear-gradient(160deg, ${color.from} 0%, ${color.to} 100%)`,
                              boxShadow: `0 12px 28px -10px ${color.glow}, 0 3px 8px rgba(1,22,16,0.28)`,
                            }
                      }
                    >
                      <Icon size={36} strokeWidth={2} />
                    </span>
                    {/* status badge */}
                    {soon && (
                      <span className="absolute -right-2 -top-2 inline-flex items-center gap-0.5 rounded-full bg-[#A7F3D0] px-1.5 py-0.5 text-[9.5px] font-bold text-[#04503A] shadow" title="Coming soon">
                        <Sparkles size={9} /> Soon
                      </span>
                    )}
                    {locked && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[var(--text-tertiary)] shadow" title={isAdmin ? 'Add to plan' : 'Not in your plan'}>
                        <Lock size={11} />
                      </span>
                    )}
                  </span>
                  <span className="max-w-[104px] text-center text-[13px] font-medium leading-tight text-white">
                    {tile.label}
                  </span>
                </motion.button>
              )
            })}
          </div>
        )}

        {/* Locked hint for admins — quiet, under the grid */}
        {isAdmin && tiles.some(t => t.status === 'locked') && (
          <p className="mt-12 text-center text-[12.5px] text-white/55">
            Locked apps open the plan configurator — add them any time.
          </p>
        )}
      </div>
    </div>
  )
}
