import React, { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { Menu } from '@/design/kit/Menu'
import { WorkspaceTile } from '@/design/shell/ShellChrome'
import { ShellIcon } from '@/design/shell/shellIcons'
import { CompanySwitcher } from '@/design/shell/CompanySwitcher'
import { NotificationBell } from '@/design/shell/notifications/NotificationBell'
import { guardedGo } from '@/design/shell/navigationGuard'
import { clearLastPages } from '@/design/shell/navModel'
import { saveRailVia } from '@/layouts/railLit'
import { usePageTitle, useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { useWelcomeOnScreen } from '@/core/auth/WelcomeSplash'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { mayPunchFromWeb } from '@/modules/hrms/attendance/webpunch/punchPromptRules'
import { RouteErrorBoundary } from '@/shared/components/RouteErrorBoundary'
import { PageSkeleton } from '@/shared/components/PageSkeleton'
import { preloadPath } from '@/shared/routing/lazyPage'
import { useBusinessSettings } from './businessSettings'
import { useMarketingLauncher } from '@/core/marketing/useMarketingLauncher'
import { MarketingLaunchDialog, MarketingShellLink } from '@/core/marketing/MarketingLaunch'
import '@/design/shell/shell.css'

// The check-in prompt after sign-in, as in the HRMS shell (the Apps page can be the first page after sign-in).
const PunchPrompt = React.lazy<React.ComponentType<{ ready: boolean }>>(() => import('@/modules/hrms/attendance/webpunch/PunchPrompt')
  .then((m) => ({ default: m.PunchPrompt }), () => ({ default: () => null })))

/** A plain left click (not a new tab / window). */
const plainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

/**
 * The frame outside the modules (owner, 10 Oct 2026): no HRMS rail.
 * - The Apps page (/modules): the business's name and the company selector on the left; Business settings,
 *   Marketing, the bell and the account menu (profile, sign out) on the right.
 * - Business settings (/business/*, master context §11): its own page, the settings as a left menu and the
 *   open one beside it; "All apps" goes back to the Apps page. The pages are the ones HRMS shows under Settings.
 */
export function BusinessShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const items = useBusinessSettings()
  const launcher = pathname === '/modules'
  const active = items.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'))
  usePageTitle(launcher ? 'All apps' : active?.label ?? 'Business settings')
  const go = (to: string) => guardedGo(() => navigate(to))
  // Marketing (another app): only when this build names it and the person has a company with it.
  const marketing = useMarketingLauncher()
  const { workspaceName } = useWorkspaceBranding()
  const { greetingName } = useDisplayName()
  const logout = useSdkStore((s) => s.logout)
  const accessCtx = useAccessContext()
  const welcomeOnScreen = useWelcomeOnScreen()
  const [notifOpen, setNotifOpen] = useState(false)
  useEffect(() => { setNotifOpen(false) }, [pathname])
  const signOut = () => { saveRailVia(null); clearLastPages(); logout() }

  const content = (
    <RouteErrorBoundary resetKey={pathname} routeLabel={pathname}>
      <React.Suspense fallback={<PageSkeleton path={pathname} />}><Outlet /></React.Suspense>
    </RouteErrorBoundary>
  )

  return (
    <div className="company-workspace ut-shell">
      <main className="ut-shell__main">
        <header className="ut-topbar ut-frame__bar">
          <div className="ut-frame__brand">
            <span className="ut-frame__tile" aria-hidden="true"><WorkspaceTile /></span>
            <span className="ut-frame__name">{launcher ? (workspaceName || 'All apps') : 'Business settings'}</span>
            {launcher && <CompanySwitcher />}
          </div>
          <div className="ut-topbar__right">
            {launcher && items.length > 0 && (
              <a href={items[0].path} className="ut-biz__apps" aria-label="Business settings" onMouseEnter={() => preloadPath(items[0].path)}
                onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); go(items[0].path) }}>
                <SettingsIcon size={16} aria-hidden="true" />
                <span className="ut-frame__label">Business settings</span>
              </a>
            )}
            {/* The Apps page has Marketing as a tile already. */}
            {!launcher && marketing.visible && <MarketingShellLink launcher={marketing} />}
            {!launcher && (
              <a href="/modules" className="ut-biz__apps" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); go('/modules') }}>
                <ShellIcon name="layers" size={16} />
                <span>All apps</span>
              </a>
            )}
            {launcher && (
              <NotificationBell open={notifOpen} onToggle={() => setNotifOpen((v) => !v)} onClose={() => setNotifOpen(false)}
                onNavigate={(to) => { setNotifOpen(false); navigate(to) }} />
            )}
            {launcher && (
              <Menu
                label="Account"
                width={240}
                header={{ title: greetingName || 'Account' }}
                items={[
                  { key: 'profile', label: 'My profile', icon: <UserRound size={18} aria-hidden="true" />, onSelect: () => go('/profile') },
                  { key: 'sep', separator: true },
                  { key: 'signout', label: 'Sign out', icon: <LogOut size={18} aria-hidden="true" />, danger: true, onSelect: signOut },
                ]}
                trigger={({ props, open }) => (
                  <button type="button" {...props} className="ut-frame__acct" data-open={open ? '' : undefined} aria-label="Account: profile and sign out">
                    {(greetingName || '?').trim().charAt(0).toUpperCase()}
                  </button>
                )}
              />
            )}
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-auto">
          {launcher ? content : (
            <div className="ut-bizset">
              <nav className="ut-bizset__nav" aria-label="Business settings">
                <p className="ut-bizset__head">Business settings</p>
                {items.map((i) => {
                  const Icon = i.icon
                  return (
                    <a key={i.key} href={i.path} className="ut-bizset__item" aria-current={i === active ? 'page' : undefined}
                      onMouseEnter={() => preloadPath(i.path)}
                      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); go(i.path) }}>
                      <Icon size={17} aria-hidden="true" />
                      <span>{i.label}</span>
                    </a>
                  )
                })}
              </nav>
              <div className="ut-bizset__body">{content}</div>
            </div>
          )}
        </div>
      </main>
      <MarketingLaunchDialog launcher={marketing} />
      {launcher && mayPunchFromWeb(accessCtx) && (
        <React.Suspense fallback={null}><PunchPrompt ready={!welcomeOnScreen} /></React.Suspense>
      )}
    </div>
  )
}
