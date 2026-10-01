import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { NotificationBell } from '@/design/shell/notifications/NotificationBell'
import { TopBarSearch } from '@/shared/components/TopBarSearch'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { openSearch } from '@/design/shell/search/searchStore'
import { usePageTitle, useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { apiJson } from '@/core/api/client'
import type { ModulePlan } from '@/core/api/modulePlans'
import { RouteErrorBoundary } from '@/shared/components/RouteErrorBoundary'
import { PageSkeleton } from '@/shared/components/PageSkeleton'
import { preloadPath, preloadPathsWhenIdle } from '@/shared/routing/lazyPage'
import { litRail, railViaOn, railViaTo, readRailVia, saveRailVia, type RailVia } from '@/layouts/railLit'
import { AppRail, type RailGroupView, type RailItem } from '@/design/shell/AppRail'
import { ModuleTabs } from '@/design/shell/ModuleTabs'
import { TopBar } from '@/design/shell/TopBar'
import { MorePanel, type MoreSection } from '@/design/shell/MorePanel'
import { HelpPanel, useHelpContacts } from '@/design/shell/HelpPanel'
import { DesignTooltip, MobileDrawer, WorkspaceTile, type DrawerPages } from '@/design/shell/ShellChrome'
import { useHome } from '@/design/shell/useHome'
import { guardedGo } from '@/design/shell/navigationGuard'
import { pageTitleLabel } from '@/design/shell/pageTitle'
import {
  SETTINGS_MODULE, clearLastPages, drawsOwnPages, fitRail, isMorePath, isSettingsPath, litPage, matchPath, moduleTarget, owningModules,
  preferencesTarget, railGroups, readLastPages, readPinned, routeOf, saveLastPage, savePinned, settingsActive, settingsPages,
  type NavPage, type VisibleModule,
} from '@/design/shell/navModel'

// The app shell (design: HrmsPlatform.dc.html). A 72px rail of named groups that widens on hover or
// focus (or stays open when pinned), a white top bar with the open module's pages as tabs (ModuleTabs;
// a page that is its module's only page shows its name as one pill), and More: the person's space,
// what didn't fit the rail, settings, the theme and Sign out. A page's own views sit inside the page,
// under the top bar (DECISIONS 21: the left Pages panel is gone). Who sees what is decided by
// permissions alone (design/shell/navModel.ts over shared/navigation/pageRegistry.ts); which item is
// lit by railLit. On a phone the drawer is the rail with the open module's pages under its item.

// A role's display name for the More card when the person's employee record has no job title.
// Presentation only: nothing is decided by it.
const ROLE_PRIORITY = ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD', 'DEPT_MANAGER', 'MANAGER', 'EMPLOYEE'] as const
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin',
  OWNER: 'Company Owner', ADMIN: 'Company Admin', MANAGER: 'Manager',
  HR_MANAGER: 'HR Manager', FINANCE_LEAD: 'Finance Lead',
  DEPT_MANAGER: 'Dept Manager', EMPLOYEE: 'Employee',
}

/** Pages that read "?q=" (the search opens them filtered): the top bar shows the filter and can clear it. */
function readsQuery(pathname: string, params: URLSearchParams, canAuthorPolicies: boolean): boolean {
  if (matchPath(pathname, '/hrms/employees') && !/^\/hrms\/employees\/.+/.test(pathname)) return true
  if (/^\/hrms\/payroll\/runs\/[^/]+$/.test(pathname)) return params.get('tab') === 'employees'
  // Policy authors' Policy Documents page reads it; the reading view doesn't.
  if (pathname === '/hrms/policies') return canAuthorPolicies && params.get('view') !== 'documents'
  return false
}

/**
 * Navigate from the search palette. Pages that keep their tab in the URL with
 * `useView` read it on mount and on popstate, so a jump to another tab of the
 * page already open (Leave → Leave › Approvals) also nudges them with a
 * popstate; the location itself is unchanged by it.
 */
function openInApp(navigate: (to: string) => void, path: string) {
  const samePage = window.location.pathname === path.split('?')[0]
  navigate(path)
  if (samePage) window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

/** The plan catalog's "launching soon" module keys (the business apps' Soon badges); plan admins only. */
function useSoonApps(enabled: boolean): ReadonlySet<string> {
  const plans = useQuery({
    queryKey: ['module-plans'],
    queryFn: () => apiJson<ModulePlan[]>('/v1/public/module-plans'),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled,
  })
  return useMemo(() => new Set((plans.data ?? []).filter((p) => p.status === 'LAUNCHING_SOON').flatMap((p) => p.includedModules)), [plans.data])
}

export function PlatformShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pinned, setPinned] = useState(readPinned)
  // The rail item the person came through (a rail click, or one of its pages in the top bar's tabs)
  // and the page that click opened; see railLit.ts.
  const [railVia, setRailVia] = useState<RailVia | null>(readRailVia)
  const [listH, setListH] = useState(0)
  // Bumped to show a page again from scratch (after its "?q=" filter is cleared).
  const [outletKey, setOutletKey] = useState(0)
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const logout = useSdkStore(s => s.logout)
  const user = useSdkStore(s => s.user)
  const userRoles: string[] = user?.roles ?? []
  const primaryRole = (ROLE_PRIORITY as readonly string[]).find(r => userRoles.includes(r)) ?? null
  const roleLabel = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : null
  const { workspaceName } = useWorkspaceBranding()
  const pathname = location.pathname

  useEffect(() => { setNotifOpen(false); setMobileOpen(false); setMoreOpen(false) }, [pathname])

  // Menus are permission-only: a link shows when the person holds the permission its page needs and
  // the workspace has the page's module (the same rules the ⌘K search uses).
  const accessCtx = useAccessContext()
  const home = useHome()
  const soonApps = useSoonApps(accessCtx.planAdmin)
  const groups = useMemo(() => railGroups(accessCtx, { selfFirst: home.kind !== 'admin', soonApps }), [accessCtx, home.kind, soonApps])

  // What fits the rail's height; the rest moves into More (the design's fit()).
  const fitted = useMemo(() => fitRail(listH, groups.map(g => ({ key: g.key, items: g.modules.map(m => m.key) }))), [listH, groups])
  const overflow = useMemo(() => new Set(fitted.overflow), [fitted])
  const listObs = useRef<ResizeObserver | null>(null)
  const listRef = useCallback((el: HTMLDivElement | null) => {
    listObs.current?.disconnect()
    listObs.current = null
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const h = Math.floor(el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0))
      setListH(prev => (Math.abs(h - prev) >= 1 ? h : prev))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      listObs.current = new ResizeObserver(measure)
      listObs.current.observe(el)
    }
  }, [])
  useEffect(() => () => listObs.current?.disconnect(), [])

  // ── Which item is lit, and the module on screen ──
  const settingsScope = isSettingsPath(pathname)
  const owning = useMemo(() => owningModules(groups, pathname), [groups, pathname])
  const lit = litRail(owning.map(m => ({ key: m.key, tabs: m.pages.length })), railViaOn(railVia, pathname), { morePage: isMorePath(pathname), overflow })
  const litModule: VisibleModule | undefined = lit.module ? owning.find(m => m.key === lit.module) : undefined
  const sPages = useMemo(() => settingsPages(accessCtx), [accessCtx])
  const current: { key: string; label: string; icon: string; pages: NavPage[] } | null = settingsScope
    ? { key: SETTINGS_MODULE.key, label: SETTINGS_MODULE.label, icon: SETTINGS_MODULE.icon, pages: sPages }
    : litModule ? { key: litModule.key, label: litModule.name, icon: litModule.icon, pages: litModule.pages } : null
  const currentPage = settingsScope ? settingsActive(sPages, pathname) : litModule ? litPage(litModule.key, litModule.pages, pathname) : undefined
  // The module's pages show as tabs along the top bar when it has several (a page that draws the
  // module's pages itself keeps its own bar: navModel.drawsOwnPages).
  const tabPages = current && current.pages.length > 1 && !drawsOwnPages(current.key)
    ? current.pages.map((p) => ({ label: p.label, href: p.path, active: p === currentPage }))
    : null
  // A pinned rail takes its room.
  const push = pinned

  // The click counts only on the page it opened. Any other move to another page (a link on the page,
  // search, a notification, Back, a load or sign-in elsewhere) forgets it. Checked only when the page
  // itself changes, so a click still on its way is not forgotten.
  const railPath = useRef<string | null>(null)
  useEffect(() => {
    if (railPath.current === pathname) return
    railPath.current = pathname
    if (railVia && !railViaOn(railVia, pathname)) { setRailVia(null); saveRailVia(null) }
  }, [pathname, railVia])

  // A module remembers the last page used in it (this browser tab): its rail item opens there next time.
  useEffect(() => {
    if (litModule && currentPage) saveLastPage(litModule.key, currentPage.path)
  }, [litModule, currentPage])

  // Fetch the code of every page this person can reach from the rail while the browser is idle, so
  // opening one doesn't wait on a download (lazyPage.ts).
  const reachable = [...groups.flatMap(g => g.modules.flatMap(m => m.pages.map(p => routeOf(p.path)))), ...sPages.map(p => p.path)].join('|')
  useEffect(() => {
    if (!reachable) return
    const t = window.setTimeout(() => preloadPathsWhenIdle(reachable.split('|')), 1200)
    return () => window.clearTimeout(t)
  }, [reachable])

  // Browser tab: "<Page> - <Workspace>" (white label), named as before the redesign (pageTitle.ts).
  usePageTitle(useMemo(() => pageTitleLabel(pathname, accessCtx), [pathname, accessCtx]))

  // ── Moving around (every move asks the leave guards first) ──
  const remember = (key: string, to: string) => { const v = railViaTo(key, to); setRailVia(v); saveRailVia(v) }
  const openModule = (m: VisibleModule) => {
    const target = moduleTarget(m, readLastPages())
    guardedGo(() => {
      remember(m.key, target)
      setMoreOpen(false)
      setMobileOpen(false)
      navigate(target)
    })
  }
  const byKey = (key: string) => groups.flatMap(g => g.modules).find(m => m.key === key)
  // One of the open module's pages (its tab in the top bar, or under its item in the phone drawer):
  // the module's rail item stays lit.
  const openPage = (href: string) => guardedGo(() => {
    if (current && current.key !== SETTINGS_MODULE.key) remember(current.key, href)
    setMobileOpen(false)
    navigate(href)
  })
  const goTo = (to: string, after?: () => void) => guardedGo(() => {
    setMoreOpen(false)
    setMobileOpen(false)
    after?.()
    navigate(to)
  })
  const goHome = () => goTo(home.path, () => { setRailVia(null); saveRailVia(null) })
  const openPreferences = () => goTo(preferencesTarget(accessCtx))
  const signOut = () => { saveRailVia(null); clearLastPages(); logout() }
  const togglePin = () => { const next = !pinned; setPinned(next); savePinned(next) }

  // ── The rail and More ──
  const railItem = (m: VisibleModule): RailItem => ({
    key: m.key, label: m.railLabel, name: m.name, icon: m.icon, href: moduleTarget(m, readLastPages()),
    lit: lit.key === m.key, hasPages: m.pages.length > 1, soon: m.soon,
  })
  const railView: RailGroupView[] = groups
    .map(g => ({ key: g.key, label: g.label, items: g.modules.filter(m => fitted.shown.has(m.key)).map(railItem) }))
    .filter(g => g.items.length > 0)
  const drawerView: RailGroupView[] = groups.map(g => ({ key: g.key, label: g.label, items: g.modules.map(railItem) }))
  // More lists what didn't fit (not the business apps, as the design says), by rail group.
  const overflowSections: MoreSection[] = groups
    .filter(g => g.key !== 'apps')
    .map(g => ({
      key: `over-${g.key}`, label: g.label,
      rows: g.modules.filter(m => overflow.has(m.key) && !m.soon).map(m => ({
        key: m.key, label: m.railLabel, icon: m.icon, href: moduleTarget(m, readLastPages()), active: lit.module === m.key,
        onClick: () => openModule(m),
      })),
    }))
    .filter(g => g.rows.length > 0)
  const moreCount = overflowSections.reduce((n, g) => n + g.rows.length, 0)
  // Org chart (P-ORG): for every role with HRMS; the server limits what each person sees.
  const canSeeOrgChart = accessCtx.modules.includes('hrms') && (accessCtx.self || accessCtx.has('hrms.employee.read'))
  const mySpace: MoreSection = {
    key: 'my-space', label: 'My space', rows: [
      { key: 'my-workspace', label: 'My workspace', icon: 'grid', href: home.path, onClick: goHome },
      { key: 'my-profile', label: 'My profile', icon: 'user', href: '/profile', active: matchPath(pathname, '/profile'), onClick: () => goTo('/profile') },
      ...(canSeeOrgChart ? [{ key: 'org-chart', label: 'Org chart', icon: 'users', href: '/hrms/org-chart', active: matchPath(pathname, '/hrms/org-chart'), onClick: () => goTo('/hrms/org-chart') }] : []),
      { key: 'all-apps', label: 'All apps', icon: 'layers', href: '/modules', active: matchPath(pathname, '/modules'), onClick: () => goTo('/modules') },
    ],
  }
  const settingsSection: MoreSection = {
    key: 'settings', label: 'Settings', rows: [
      { key: 'preferences', label: 'Preferences', icon: 'settings', href: preferencesTarget(accessCtx), active: settingsScope, onClick: openPreferences },
      { key: 'help', label: 'Help & support', icon: 'help', onClick: () => { setMoreOpen(false); setMobileOpen(false); setHelpOpen(true) } },
    ],
  }
  const moreContent = {
    roleLabel,
    profileHref: '/profile',
    onProfile: () => goTo('/profile'),
    onSignOut: signOut,
  }
  const helpContacts = useHelpContacts(helpOpen)

  // ── The top bar ──
  const canAuthorPolicies = accessCtx.has('hrms.policy.write') && accessCtx.has('hrms.policy.read')
  const q = params.get('q')
  const chip = q && readsQuery(pathname, params, canAuthorPolicies)
    ? { query: q, onClear: () => { const next = new URLSearchParams(params); next.delete('q'); setParams(next, { replace: true }); setOutletKey(k => k + 1) } }
    : null
  const pillFor = (): { label: string; icon: string } | null => {
    if (currentPage && current) return { label: currentPage.label, icon: current.icon }
    const entry = PAGE_REGISTRY.find(e => !e.parent && routeOf(e.path) === pathname)
    const label = entry?.label ?? pageTitleLabel(pathname, accessCtx)
    if (!label) return null
    return { label, icon: current?.icon ?? (matchPath(pathname, '/profile') ? 'user' : matchPath(pathname, '/modules') ? 'layers' : 'grid') }
  }
  const intent = (href: string) => preloadPath(routeOf(href))
  const topTabs = tabPages && current
    ? <ModuleTabs module={{ label: current.label, icon: current.icon }} pages={tabPages} onSelect={openPage} onIntent={intent} />
    : null
  // The phone drawer lists the open module's pages under its item (the settings pages, on a settings page).
  const drawerPages: DrawerPages | null = current && current.pages.length > 1
    ? { key: current.key, label: current.label, items: current.pages.map((p) => ({ label: p.label, href: p.path, active: p === currentPage })) }
    : null

  return (
    <>
      <div className="company-workspace ut-shell">
        <a href="#workspace-content" className="workspace-skip-link">Skip to workspace</a>
        <AppRail
          groups={railView}
          workspaceName={workspaceName}
          mark={<WorkspaceTile />}
          homeHref={home.path}
          homeLabel={home.label || 'Home'}
          onHome={goHome}
          pinned={pinned}
          onTogglePin={togglePin}
          push={push}
          noExpand={moreOpen && !push}
          more={{ open: moreOpen, lit: lit.more, count: moreCount, onToggle: () => { setNotifOpen(false); setMoreOpen(v => !v) } }}
          onItem={(key) => { const m = byKey(key); if (m) openModule(m) }}
          onIntent={intent}
          listRef={listRef}
        >
          {moreOpen && (
            <MorePanel onClose={() => setMoreOpen(false)} sections={[mySpace, ...overflowSections, settingsSection]} {...moreContent} />
          )}
        </AppRail>

        <main className="ut-shell__main">
          <TopBar
            tabs={topTabs}
            pill={topTabs ? null : pillFor()}
            chip={chip}
            search={
              <TopBarSearch
                onOpen={(path) => openInApp(navigate, path)}
                onOpened={() => { setMoreOpen(false); setNotifOpen(false) }}
                // "On this page" filters a page that reads "?q=" (the same pages as the filter chip).
                onThisPage={readsQuery(pathname, params, canAuthorPolicies)
                  ? { label: pillFor()?.label ?? 'this page', apply: (text) => { const next = new URLSearchParams(params); next.set('q', text); setParams(next); setOutletKey(k => k + 1) } }
                  : null}
              />
            }
            bell={<NotificationBell open={notifOpen} onToggle={() => { setMoreOpen(false); setNotifOpen(v => !v) }} onClose={() => setNotifOpen(false)} onNavigate={(to) => { setNotifOpen(false); navigate(to) }} />}
            onMenu={() => setMobileOpen(true)}
            onSearch={() => openSearch()}
            mark={<WorkspaceTile />}
          />
          {/* data-module-tabs: the module whose pages the top bar shows as tabs; a page that still draws
              the same pages itself hides that copy (shell.css). */}
          <div id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-auto" data-module-tabs={topTabs && current ? current.key : undefined}>
            {/* The shell stays put between pages: a broken page is contained here, and a page whose
                code is still arriving shows its own outline instead of blanking the app. */}
            <RouteErrorBoundary resetKey={pathname} routeLabel={pathname}>
              <React.Suspense fallback={<PageSkeleton path={pathname} />}><Outlet key={outletKey} /></React.Suspense>
            </RouteErrorBoundary>
          </div>
        </main>

        {moreOpen && <div className="ut-more-backdrop" aria-hidden="true" onClick={() => setMoreOpen(false)} />}
        {mobileOpen && (
          <MobileDrawer
            groups={drawerView}
            workspaceName={workspaceName}
            onClose={() => setMobileOpen(false)}
            onItem={(key) => { const m = byKey(key); if (m) openModule(m) }}
            pages={drawerPages}
            onPage={openPage}
            sections={[mySpace, settingsSection]}
            {...moreContent}
          />
        )}
        <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} contacts={helpContacts} />
        <DesignTooltip />
      </div>
    </>
  )
}

