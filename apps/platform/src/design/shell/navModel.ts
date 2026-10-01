// The shell's navigation model: the design's rail groups (HrmsPlatform.dc.html, hrms-core.js
// GROUPS / RGROUPS) laid over today's menu items (DECISIONS 11, AUDIT §5.1).
//
// - Every module keeps today's internal key, which is also its MENU_RULES group, and every page
//   keeps its path. A link shows only when menuRule(path, key) passes for the person (the same
//   rules the ⌘K search uses), so who sees what is decided by permissions alone.
// - "My work" replaces the single Employee Self Service item. Each of its pages has its own
//   MENU_RULES entry (a copy of today's self-service rule, admin roles excluded).
// - Only the grouping, the order of the groups and the rail labels are new.
//
// Pure functions only (no React), so the rules are unit-tested (navModel.test.ts).
import { accessState, type AccessContext } from '@/shared/navigation/access'
import { menuRule } from '@/shared/navigation/pageRegistry'

export type RailGroupKey = 'home' | 'team' | 'mine' | 'people' | 'time' | 'pay' | 'org' | 'insights' | 'apps'

/** The design's group labels. The first group shows no label (design). */
export const RAIL_GROUP_LABELS: Record<RailGroupKey, string> = {
  home: 'Home', team: 'My team', mine: 'My work', people: 'People', time: 'Time', pay: 'Pay & benefits', org: 'Org & policy', insights: 'Insights', apps: 'Business apps',
}

/** People whose Home is the self-service Home see their own groups first (the design's manager and employee rails). */
const SELF_FIRST: RailGroupKey[] = ['home', 'team', 'mine', 'people', 'time', 'pay', 'org', 'insights', 'apps']
/** People whose Home is the admin dashboard see the admin groups first (the design's admin rail). */
const ADMIN_FIRST: RailGroupKey[] = ['home', 'people', 'time', 'pay', 'org', 'insights', 'team', 'mine', 'apps']

export interface NavPage {
  /** Today's page name (its tab in the top bar; the page pill). */
  label: string
  /** Where it opens; a My work page may carry the tab it opens on (?tab=my). */
  path: string
  /** Other routes that belong to this page (its tab is lit on them). */
  also?: string[]
  /** Owns only its own address, not the ones under it (Home at /me doesn't own /me/payslips). */
  exact?: boolean
}

export interface NavModule {
  /** Today's internal key: the MENU_RULES group and the key railLit remembers. */
  key: string
  /** The rail label (design). */
  label: string
  /** My work: the label when a visible admin module has the same one, and always its accessible name. */
  myLabel?: string
  /** Shell icon name (shellIcons.tsx). */
  icon: string
  group: RailGroupKey
  pages: NavPage[]
  /** A business app: the module key the plan catalog lists it under (its "Soon" badge). */
  app?: string
}

const MASTER_ORG = ['/hrms/master/companies', '/hrms/master/branches', '/hrms/master/departments', '/hrms/master/designations', '/hrms/master/grades']

export const NAV_MODULES: readonly NavModule[] = [
  // ── Home ──
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'home', pages: [{ label: 'Dashboard', path: '/dashboard', exact: true }] },
  { key: 'home', label: 'Home', icon: 'home', group: 'home', pages: [{ label: 'Home', path: '/me', also: ['/hrms/ess'], exact: true }] },
  { key: 'company', label: 'Company', icon: 'building', group: 'home', pages: [{ label: 'Companies & Branches', path: '/hrms/companies' }] },
  // ── My team ──
  { key: 'myteam', label: 'My team', icon: 'users', group: 'team', pages: [{ label: 'My Team', path: '/team' }] },
  // ── My work (the old Employee Self Service item, split as the design does) ──
  { key: 'mytime', label: 'Time', myLabel: 'My time', icon: 'clock', group: 'mine', pages: [
    { label: 'Attendance', path: '/hrms/attendance' },
    { label: 'Work from home', path: '/me/wfh' },
    { label: 'Shift change', path: '/me/shift-change' },
  ] },
  { key: 'myleave', label: 'Leave', myLabel: 'My leave', icon: 'calendar', group: 'mine', pages: [{ label: 'Leave', path: '/hrms/leave' }] },
  { key: 'mypay', label: 'Pay', myLabel: 'My pay', icon: 'wallet', group: 'mine', pages: [
    { label: 'Payslips', path: '/me/payslips' },
    { label: 'Salary', path: '/me/salary' },
    { label: 'Expense claims', path: '/hrms/expenses?tab=my' },
    { label: 'Advances', path: '/hrms/advances?tab=my' },
    { label: 'My incentives', path: '/hrms/pli' },
  ] },
  { key: 'mydocs', label: 'Documents', myLabel: 'My documents', icon: 'file', group: 'mine', pages: [
    { label: 'Letters', path: '/hrms/letters/my', also: ['/hrms/letters'] },
    { label: 'My documents', path: '/hrms/documents?view=my' },
    { label: 'My assets', path: '/me/assets' },
    { label: 'Policies', path: '/hrms/policies?view=documents' },
  ] },
  { key: 'mygrowth', label: 'Growth', myLabel: 'My growth', icon: 'target', group: 'mine', pages: [
    { label: 'Reviews & goals', path: '/hrms/performance?view=my-reviews' },
    { label: 'Learning', path: '/hrms/learning?view=my' },
    { label: 'My interviews', path: '/me/interviews' },
  ] },
  // ── People ──
  { key: 'master', label: 'Workforce', icon: 'database', group: 'people', pages: [
    { label: 'Overview', path: '/hrms/master' },
    { label: 'Workforce Directory', path: '/hrms/employees', also: ['/hrms/master/contractors', '/hrms/master/classifications'] },
    { label: 'Organization Setup', path: '/hrms/organization', also: MASTER_ORG },
    { label: 'Rules & Policies', path: '/hrms/master/shift-rules', also: ['/hrms/master/leave-rules', '/hrms/policies'] },
    { label: 'Payroll Configuration', path: '/hrms/payroll/components', also: ['/hrms/master/statutory'] },
  ] },
  { key: 'recruit', label: 'Hiring & onboarding', icon: 'userPlus', group: 'people', pages: [
    { label: 'Hiring Pipeline', path: '/hrms/hiring' },
    { label: 'Onboarding & Assets', path: '/hrms/onboarding/instances', also: ['/hrms/onboarding'] },
    { label: 'Letters', path: '/hrms/letters' },
    { label: 'Employee Vault', path: '/hrms/documents' },
    { label: 'Docs to Review', path: '/hrms/documents/pending', also: ['/documents/pending'] },
  ] },
  { key: 'performance', label: 'Performance', icon: 'target', group: 'people', pages: [
    { label: 'Performance Center', path: '/hrms/performance' },
    { label: 'Learning & Skills', path: '/hrms/learning' },
  ] },
  { key: 'exit', label: 'Employee exit', icon: 'logOut', group: 'people', pages: [
    { label: 'Resignation & Exit', path: '/hrms/exit' },
    { label: 'Full & Final Settlement', path: '/hrms/fnf' },
  ] },
  // ── Time ──
  { key: 'attendance', label: 'Attendance & time', icon: 'clock', group: 'time', pages: [
    { label: 'Attendance Analytics', path: '/hrms/att-analytics' },
    { label: 'Daily Tracking', path: '/hrms/attendance' },
    { label: 'Shifts & Overtime', path: '/hrms/shifts' },
  ] },
  { key: 'leave', label: 'Leave', icon: 'calendar', group: 'time', pages: [{ label: 'Leave Operations Center', path: '/hrms/leave' }] },
  // ── Pay & benefits ──
  { key: 'payroll-hr', label: 'Payroll', icon: 'card', group: 'pay', pages: [
    { label: 'Payroll Dashboard', path: '/hrms/payroll-dashboard' },
    { label: 'Salary Structure', path: '/hrms/salary-structure' },
    { label: 'Processing & Payslips', path: '/hrms/payroll/runs' },
    { label: 'Payroll Settings', path: '/hrms/payroll/settings' },
    { label: 'Production-Linked Incentive', path: '/hrms/pli' },
    { label: 'Advances & Loans', path: '/hrms/advances' },
    { label: 'Bank Disbursement', path: '/hrms/bank-disbursement' },
  ] },
  { key: 'expense', label: 'Expenses', icon: 'receipt', group: 'pay', pages: [{ label: 'Expense Center', path: '/hrms/expenses' }] },
  // ── Org & policy ──
  { key: 'compliance', label: 'Compliance', icon: 'shield', group: 'org', pages: [
    { label: 'Statutory Compliance', path: '/hrms/compliance' },
    { label: 'Muster Roll', path: '/hrms/muster-roll' },
  ] },
  { key: 'hrsettings', label: 'HR setup', icon: 'sliders', group: 'org', pages: [
    { label: 'HR Configuration', path: '/hrms/settings' },
    { label: 'Notification Templates', path: '/hrms/notification-templates' },
    { label: 'Integrations', path: '/hrms/integrations' },
  ] },
  // ── Insights ──
  { key: 'reports', label: 'Reports', icon: 'chart', group: 'insights', pages: [
    { label: 'Reports Center', path: '/hrms/reports' },
    { label: 'Workforce Analytics', path: '/hrms/workforce-analytics' },
  ] },
  // ── Business apps (plan admins only; their links are not in the registry) ──
  { key: 'crm', label: 'CRM', icon: 'trending', group: 'apps', app: 'crm', pages: [
    { label: 'Leads', path: '/crm/leads', also: ['/crm'] }, { label: 'Customers', path: '/crm/customers' }, { label: 'Deals', path: '/crm/deals' },
  ] },
  { key: 'accounts', label: 'Accounts', icon: 'dollar', group: 'apps', app: 'accounting', pages: [
    { label: 'Invoices', path: '/accounts/invoices', also: ['/accounts', '/accounting'] }, { label: 'Payments', path: '/accounts/payments' }, { label: 'Expenses', path: '/accounts/expenses' },
  ] },
  { key: 'projects', label: 'Projects', icon: 'briefcase', group: 'apps', app: 'projects', pages: [
    { label: 'All Projects', path: '/projects' }, { label: 'Task Board', path: '/projects/board' },
  ] },
  { key: 'inventory', label: 'Inventory', icon: 'package', group: 'apps', app: 'inventory', pages: [{ label: 'Inventory', path: '/inventory' }] },
  { key: 'procurement', label: 'Purchase', icon: 'cart', group: 'apps', app: 'purchase', pages: [{ label: 'Procurement', path: '/procurement', also: ['/purchase'] }] },
]

/**
 * Modules whose pages still draw the module's pages themselves, inside the page: the Attendance page's
 * "Attendance sections" bar (Analytics, Daily Tracking, Shifts & Overtime), until that page is rebuilt.
 * The top bar then shows the page's name as one pill rather than the same pages again as tabs. When the
 * rebuilt page drops its own bar, remove its key here so the top bar shows the module's pages.
 * (Payroll's and Workforce's own bars are hidden instead, by the shell's CSS, while the top bar shows them.)
 */
export const OWN_PAGES_BAR: ReadonlySet<string> = new Set(['attendance'])
export const drawsOwnPages = (moduleKey: string) => OWN_PAGES_BAR.has(moduleKey)

// ── Settings: not a rail module (More → Settings → Preferences opens it; More lights on it) ──

/** Settings addresses that must pass their route guard as well as their menu rule (App.tsx). */
export const SETTINGS_ROUTE_CODES = ['settings.read', 'settings.hrconfig.write', 'settings.holidays.write', 'hrms.probation.config.read', 'workspace.profile.update', 'workspace.security.manage']
const SETTINGS_TAB_CODES = [...SETTINGS_ROUTE_CODES, 'settings.branding.write']

interface SettingsPage extends NavPage { route?: readonly string[] }

/** Today's settings row, in its order, with Document types after Integrations (AUDIT §5.3). */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { label: 'Profile', path: '/profile' },
  { label: 'Branding', path: '/settings/branding', route: SETTINGS_TAB_CODES },
  { label: 'Security', path: '/settings/security' },
  { label: 'Notifications', path: '/settings/notifications', route: SETTINGS_TAB_CODES },
  { label: 'Billing & Plan', path: '/settings/billing' },
  { label: 'Integrations', path: '/settings/integrations', route: SETTINGS_TAB_CODES },
  { label: 'Document types', path: '/settings/documents', route: SETTINGS_TAB_CODES },
  { label: 'Users & Access', path: '/users' },
  { label: 'Roles & Permissions', path: '/roles' },
  { label: 'Audit Logs', path: '/audit-logs' },
  { label: 'Danger Zone', path: '/settings/danger' },
]

export const SETTINGS_MODULE: NavModule = { key: 'settings', label: 'Settings', icon: 'settings', group: 'home', pages: SETTINGS_PAGES as NavPage[] }

/** The workspace-settings addresses (they keep the rail, light More and list the settings pages). */
const SETTINGS_ROOTS = ['/settings', '/users', '/roles', '/audit-logs']

export const matchPath = (pathname: string, p?: string) => !!p && (pathname === p || pathname.startsWith(p + '/'))
/** A page path without its query. */
export const routeOf = (path: string) => path.split(/[?#]/)[0]

export const isSettingsPath = (pathname: string) => SETTINGS_ROOTS.some((p) => matchPath(pathname, p))

/** Pages reached only through More: settings, My profile and All apps. The More button lights on them. */
export const isMorePath = (pathname: string) => isSettingsPath(pathname) || matchPath(pathname, '/profile') || matchPath(pathname, '/modules')

/** The settings page to light: the one at this address; /settings itself opens on the (workspace) Profile section. */
export function settingsActive(pages: readonly NavPage[], pathname: string): NavPage | undefined {
  return pages.find((p) => matchPath(pathname, p.path)) ?? (pathname === '/settings' ? pages.find((p) => p.path === '/profile') : undefined)
}

// ── Visibility ────────────────────────────────────────────────────────────────

/** Whether a page's link shows for this person (its menu rule; links the registry doesn't know: plan admins only). */
export function pageVisible(page: NavPage, moduleKey: string | undefined, ctx: AccessContext): boolean {
  const rule = menuRule(page.path, moduleKey)
  if (rule) return accessState(rule, ctx) !== 'hidden'
  return ctx.planAdmin
}

export interface VisibleModule extends NavModule {
  /** The pages this person may see, in today's order. */
  pages: NavPage[]
  /** The label on the rail ("Leave", or "My leave" when an admin Leave shows too). */
  railLabel: string
  /** Accessible name and tooltip (My work items always read "My …"). */
  name: string
  /** A business app the plan catalog says is launching soon. */
  soon: boolean
}

export interface VisibleGroup { key: RailGroupKey; label: string; modules: VisibleModule[] }

export interface RailOptions {
  /** The person's Home is the self-service Home (useHome): their own groups come first. */
  selfFirst: boolean
  /** Business apps the catalog lists as launching soon (their module keys). */
  soonApps?: ReadonlySet<string>
}

/** The rail for this person: groups in order, each with the modules that have at least one visible page. */
export function railGroups(ctx: AccessContext, opts: RailOptions): VisibleGroup[] {
  const mods: VisibleModule[] = []
  for (const m of NAV_MODULES) {
    const pages = m.pages.filter((p) => pageVisible(p, m.key, ctx))
    if (!pages.length) continue
    mods.push({ ...m, pages, railLabel: m.label, name: m.myLabel ?? m.label, soon: !!(m.app && opts.soonApps?.has(m.app)) })
  }
  // A My work item reads "My …" when a visible admin item has its label (DECISIONS 11).
  const adminLabels = new Set(mods.filter((m) => m.group !== 'mine').map((m) => m.label.toLowerCase()))
  for (const m of mods) if (m.group === 'mine' && m.myLabel && adminLabels.has(m.label.toLowerCase())) m.railLabel = m.myLabel
  const order = opts.selfFirst ? SELF_FIRST : ADMIN_FIRST
  return order
    .map((key) => ({ key, label: RAIL_GROUP_LABELS[key], modules: mods.filter((m) => m.group === key) }))
    .filter((g) => g.modules.length > 0)
}

/** The settings pages this person may see (the top bar's tabs on a settings page). */
export function settingsPages(ctx: AccessContext): NavPage[] {
  return SETTINGS_PAGES.filter((p) => pageVisible(p, undefined, ctx))
}

/**
 * More → Settings → Preferences: the first settings page the person can open. The workspace settings
 * (/settings) when its route admits them, else the first page of the settings list (not the personal
 * Profile) whose link and route both pass; Security (auth-only) is always there.
 */
export function preferencesTarget(ctx: AccessContext): string {
  if (SETTINGS_ROUTE_CODES.some(ctx.has)) return '/settings'
  for (const p of SETTINGS_PAGES) {
    if (p.path === '/profile' || !pageVisible(p, undefined, ctx)) continue
    if (p.route && !p.route.some(ctx.has)) continue
    return p.path
  }
  return '/settings/security'
}

// ── Where a page belongs ──────────────────────────────────────────────────────

/** How strongly a page claims this address: the length of its longest matching route (0 = not at all). */
export function pageScore(page: NavPage, pathname: string): number {
  let best = 0
  for (const p of [routeOf(page.path), ...(page.also ?? [])]) {
    const hit = page.exact ? pathname === p : matchPath(pathname, p)
    if (hit && p.length > best) best = p.length
  }
  return best
}

/** The module's page for this address: the longest matching route wins. */
export function activePage(pages: readonly NavPage[], pathname: string): NavPage | undefined {
  let best: NavPage | undefined, score = 0
  for (const p of pages) { const s = pageScore(p, pathname); if (s > score) { best = p; score = s } }
  return best
}

/** The rail modules that own this address (railLit decides which one to light). */
export function owningModules(groups: readonly VisibleGroup[], pathname: string): VisibleModule[] {
  return groups.flatMap((g) => g.modules).filter((m) => m.pages.some((p) => pageScore(p, pathname) > 0))
}

// ── Overflow (the design's fit(): items that don't fit the rail's height go to More) ──

export const RAIL_FIT = { itemH: 40, gap: 2, groupH: 24 }

/**
 * hrms-core.js fit(): walks the groups in order and keeps each item while it fits the height; from the
 * first item that doesn't, every later item overflows. A group after the first adds its label row.
 * Without a height yet (0), everything shows.
 */
export function fitRail(avail: number, groups: readonly { key: string; items: readonly string[] }[], cfg = RAIL_FIT): { shown: Set<string>; overflow: string[] } {
  const shown = new Set<string>(), overflow: string[] = []
  const all = !(avail > 0)
  let used = 0, cut = false
  groups.forEach((g, gi) => {
    let inGroup = 0
    for (const k of g.items) {
      if (all) { shown.add(k); continue }
      if (!cut) {
        const add = (inGroup === 0 ? (gi > 0 ? cfg.groupH : 0) : cfg.gap) + cfg.itemH
        if (used + add <= avail) { used += add; shown.add(k); inGroup++; continue }
        cut = true
      }
      overflow.push(k)
    }
  })
  return { shown, overflow }
}

// ── Where a rail click lands: the module's last page in this browser tab, else its first ──

const LAST_KEY = 'ut.rail.last'

export function readLastPages(): Record<string, string> {
  try {
    const v = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? '{}') as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, string> = {}
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) if (typeof p === 'string' && p.startsWith('/')) out[k] = p
    return out
  } catch {
    return {}
  }
}

export function saveLastPage(moduleKey: string, path: string): Record<string, string> {
  const next = { ...readLastPages(), [moduleKey]: path }
  try { sessionStorage.setItem(LAST_KEY, JSON.stringify(next)) } catch { /* private mode: rail clicks open the first page */ }
  return next
}

export function clearLastPages() {
  try { sessionStorage.removeItem(LAST_KEY) } catch { /* ignore */ }
}

/** Where clicking a module opens: its last page (still visible to the person), else its first page. */
export function moduleTarget(mod: Pick<VisibleModule, 'key' | 'pages'>, last: Record<string, string>): string {
  const remembered = last[mod.key]
  if (remembered && mod.pages.some((p) => p.path === remembered)) return remembered
  return mod.pages[0].path
}

// ── Pinned rail (per device) ──────────────────────────────────────────────────

const PIN_KEY = 'ut.rail.pinned'

export function readPinned(): boolean {
  try { return localStorage.getItem(PIN_KEY) === '1' } catch { return false }
}

export function savePinned(pinned: boolean) {
  try { if (pinned) localStorage.setItem(PIN_KEY, '1'); else localStorage.removeItem(PIN_KEY) } catch { /* ignore */ }
}
