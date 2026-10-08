import React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ModuleTabs } from '@/design/shell/ModuleTabs'
import { WorkspaceTile } from '@/design/shell/ShellChrome'
import { ShellIcon } from '@/design/shell/shellIcons'
import { guardedGo } from '@/design/shell/navigationGuard'
import { usePageTitle } from '@/core/tenant/workspaceBranding'
import { RouteErrorBoundary } from '@/shared/components/RouteErrorBoundary'
import { PageSkeleton } from '@/shared/components/PageSkeleton'
import { preloadPath } from '@/shared/routing/lazyPage'
import { useBusinessSettings } from './businessSettings'
import { useMarketingLauncher } from '@/core/marketing/useMarketingLauncher'
import { MarketingLaunchDialog, MarketingShellLink } from '@/core/marketing/MarketingLaunch'
import '@/design/shell/shell.css'

/**
 * The business frame (/business/*): the business's own settings, opened from the launcher's
 * "Business settings" (master context §11: business settings sit outside the modules). No HRMS rail,
 * no company selector: the top bar has the business settings as tabs and "All apps" back to the
 * launcher. The pages are the same ones the HRMS shell shows under Settings.
 */
export function BusinessShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const items = useBusinessSettings()
  const active = items.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'))
  usePageTitle(active?.label ?? 'Business settings')
  const go = (to: string) => guardedGo(() => navigate(to))
  const tabs = items.map((i) => ({ label: i.label, href: i.path, active: i === active }))
  // Marketing (another app), next to All apps: only when this build names it and the person has a company with it.
  const marketing = useMarketingLauncher()

  return (
    <div className="company-workspace ut-shell">
      <main className="ut-shell__main">
        <header className="ut-topbar">
          <div className="ut-topbar__phone">
            <span className="ut-topbar__tile" aria-hidden="true"><WorkspaceTile /></span>
          </div>
          <div className="ut-topbar__main">
            {tabs.length > 0 && (
              <ModuleTabs module={{ label: 'Business settings', icon: 'settings' }} pages={tabs} onSelect={go} onIntent={(h) => preloadPath(h)} />
            )}
          </div>
          <div className="ut-topbar__right">
            {marketing.visible && <MarketingShellLink launcher={marketing} />}
            <a href="/modules" className="ut-biz__apps" onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); go('/modules') }}>
              <ShellIcon name="layers" size={16} />
              <span>All apps</span>
            </a>
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-auto">
          <RouteErrorBoundary resetKey={pathname} routeLabel={pathname}>
            <React.Suspense fallback={<PageSkeleton path={pathname} />}><Outlet /></React.Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
      <MarketingLaunchDialog launcher={marketing} />
    </div>
  )
}
