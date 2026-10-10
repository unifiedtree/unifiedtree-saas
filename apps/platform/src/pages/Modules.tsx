import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { Lock, Megaphone, Users, type LucideIcon } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageFrame, PageHeader } from '@/design/kit/display'
import { Input } from '@/design/kit/overlays'
import '@/design/shell/shell.css'
import { APPS } from '@/layouts/appConfig'
import { useModulePlans, iconMap, type ModulePlan } from '@/core/api/modulePlans'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { useMarketingLauncher } from '@/core/marketing/useMarketingLauncher'
import { MarketingAppTile, MarketingLaunchDialog } from '@/core/marketing/MarketingLaunch'
import { useCanManageBilling } from '@/shared/navigation/useAccess'

/** Marketing Automation's catalogue module (the plan `marketing` includes it). */
const MARKETING_MODULE = 'whatsapp'

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
  launch?: boolean                     // the Marketing tile: opens Marketing (another app), not a route
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
  // Marketing is live (owner, 10 Oct 2026): locked until the business buys it, never "Soon".
  const status: Status = plan.status === 'LAUNCHING_SOON' && !plan.includedModules.includes(MARKETING_MODULE)
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
  'hr-employees':        { from: 'var(--u-success-2, #1F9D6E)', to: 'var(--u-br, #0F6E56)', glow: 'rgba(15,110,86,0.45)' },
  hrms:                  { from: 'var(--u-success-2, #1F9D6E)', to: 'var(--u-br, #0F6E56)', glow: 'rgba(15,110,86,0.45)' },
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
  // Holds "Can buy and manage plans and billing" (Q-26), the permission the server checks.
  const isAdmin = useCanManageBilling()

  // Backend-driven merged view — same source as the marketing site's
  // /pricing and Navbar mega-menu (platform.module_plans, RETIRED-filtered).
  const { data: plans = [], isLoading: plansLoading, isError: plansError, isFetching: plansFetching, refetch: reloadPlans } = useModulePlans()

  const [query, setQuery] = useState('')
  // Marketing (another app): a tile only when this build names it and the person has a company with it.
  const marketing = useMarketingLauncher()

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
    const live = plans.filter(p => p.status !== 'RETIRED')
    // With the Marketing tile showing, the catalog's own Marketing plan would be a second Marketing tile.
    const marketingPlan = live.find(p => p.includedModules.includes(MARKETING_MODULE))
    const catalog = live
      .filter(p => !(marketing.visible && p === marketingPlan))
      .map(p => planToTile(p, activeModules))
    // A public catalog outage must not lock people out of apps that the
    // authenticated workspace response already confirms are enabled.
    const list: Tile[] = catalog.length > 0 ? catalog : APPS
      .filter(app => app.built && activeModules.includes(app.key))
      .map((app, index) => ({ key: app.key, label: app.label, description: app.description,
        icon: app.icon, status: 'active', home: app.home, sortOrder: index }))
    // Coming-soon and locked apps are for admins only (client rule, 25 Sep):
    // they keep the request-module flow; everyone else sees just the apps
    // their workspace has and they can open.
    const mine = isAdmin ? list : list.filter(t => t.status === 'active')
    if (marketing.visible) {
      mine.push({ key: 'marketing-launch', label: 'Marketing', description: 'Opens Marketing, signed in as you',
        icon: Megaphone, status: 'active', home: '', sortOrder: marketingPlan?.sortOrder ?? 999, launch: true })
    }
    const q = query.trim().toLowerCase()
    const filtered = q
      ? mine.filter(t => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      : mine
    return filtered.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  }, [plans, query, activeModules, isAdmin, marketing.visible])

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

  const hasEnabled = activeModules.some(key => APPS.some(app => app.key === key && app.built))

  // The app launcher (All apps, More → My space): every app this workspace has, as tiles on the page
  // canvas. Admins also see the coming-soon and locked apps, which open the plan page.
  return (
    <PageFrame width="narrow" label="All apps">
      <PageHeader
        eyebrow={`${greeting}, ${firstName}`}
        title="Choose an app"
        actions={
          <div className="ut-apps__actions">
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search apps…" aria-label="Search apps" leading="search" size="md" fieldClassName="ut-apps__search" />
            {isAdmin && <Button variant="secondary" size={40} trailingIcon="arrowRight" onClick={() => openPlan()}>Manage plan</Button>}
          </div>
        }
      />

      {plansError && (
        <ErrorState
          title="We couldn't load the app catalog."
          message={hasEnabled ? 'Your enabled apps remain available below. Try again to load all apps.' : 'Try again to retrieve the available apps for your workspace.'}
          onRetry={() => { void reloadPlans() }}
          retrying={plansFetching}
          className="ut-apps__error"
        />
      )}

      {plansLoading && tiles.length === 0 && activeModules.length === 0 ? (
        <div role="status" aria-label="Loading apps" className="ut-apps__grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="ut-app ut-app--skel" aria-hidden="true">
              <span className="ut-app__icon ut-app__icon--skel" />
              <span className="ut-app__skeltext" />
            </div>
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <div role="status">
          <EmptyState
            icon="search"
            title={query.trim() ? 'No apps match your search.' : plansError ? 'The app catalog is currently unavailable.' : 'No apps are available for this workspace.'}
            action={query.trim() ? <Button variant="secondary" size={36} onClick={() => setQuery('')}>Clear search</Button> : undefined}
          />
        </div>
      ) : (
        <div className="ut-apps__grid">
          {tiles.map((tile, i) => {
            if (tile.launch) return <MarketingAppTile key={tile.key} launcher={marketing} />
            const { status } = tile
            const locked = status === 'locked'
            const soon = status === 'coming-soon'
            const Icon = tile.icon
            const color = tileColor(tile.key, i)
            const inert = soon || (locked && !isAdmin)
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => enter(tile)}
                disabled={inert}
                className="ut-app"
                data-locked={locked ? '' : undefined}
                title={tile.description}
              >
                <span
                  className="ut-app__icon"
                  style={locked ? undefined : { background: `linear-gradient(160deg, ${color.from} 0%, ${color.to} 100%)`, boxShadow: `0 12px 26px -12px ${color.glow}` }}
                >
                  <Icon size={30} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="ut-app__label">{tile.label}</span>
                {/* "Soon" keeps the tile's full colour: the chip carries the message. */}
                {soon && <span className="ut-app__chip" title="Coming soon">Soon</span>}
                {locked && (
                  <span className="ut-app__lock" title={isAdmin ? 'Add to plan' : 'Not in your plan'}>
                    <Lock size={12} aria-hidden="true" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      <MarketingLaunchDialog launcher={marketing} />

      {/* Locked hint for admins, quiet, under the grid */}
      {isAdmin && tiles.some(t => t.status === 'locked') && (
        <p className="ut-apps__hint">Locked apps open the plan configurator — add them any time.</p>
      )}

      {/* The business's own settings are not an app tile (client: tiles are real apps only): the frame's
          "Business settings" button opens them as their own page (BusinessShell). */}
    </PageFrame>
  )
}
