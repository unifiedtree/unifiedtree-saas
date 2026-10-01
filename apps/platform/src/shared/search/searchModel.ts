/**
 * The ⌘K search dialog's model (design UtSearch.dc.html): what each scope lists, the counts on
 * the scope chips, the empty dialog's quick actions and "Jump to", and the search pill's hints.
 *
 * Pure functions over what the person may see — the page registry, the quick actions, and the
 * server's answers (`GET /v1/search/global` for people and records, `GET /v1/search` for the
 * people's details). Nothing here invents a row: a row only exists because the registry or the
 * server returned it for this person.
 */
import type { AccessContext } from '../navigation/access'
import type { VisibleEntry } from '../navigation/pageRegistry'
import type { QuickAction } from './actionRegistry'
import { rankWithRanges, highlightRanges, type Range } from './rank'
import type { GlobalSearchGroup, GlobalSearchHit } from './useGlobalSearch'
import type { EmployeeSearchHit } from './useEmployeeSearch'

export type Scope = 'all' | 'people' | 'pages' | 'actions' | 'records'
export type RowKind = 'person' | 'page' | 'action' | 'record' | 'filter'
export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface SearchRow {
  key: string
  kind: RowKind
  label: string
  ranges: Range[]
  sub?: string | null
  /** Where Enter / a click goes. */
  path: string
  /** design/dc icon name (not used for people). */
  icon: string
  /** Shown on the right of an unselected row ("Page", "Action", …). */
  kindLabel: string
  badge?: { tone: BadgeTone; text: string }
  /** People: the employee id (their profile, the details from /v1/search). */
  personId?: string
  /** Pages: the tabs it has for this person. */
  tabs?: string[]
  /** Pages: the area ("Attendance & Time"); actions: the description. */
  area?: string
  description?: string
  /** Records: the server's type and group name ("leave", "Leave requests"). */
  recordType?: string
  recordGroup?: string
  /** "/" mode: the path shown and Tab's completion. */
  slashText?: string
  slashRanges?: Range[]
  complete?: string
  /** A Recent row (re-opened from this browser's list). */
  recent?: boolean
  /** Coming soon / Not in your plan. */
  pill?: string
}

export interface SearchGroup {
  /** The `data-result-group` value tests and screen readers use: employee, page, action, leave, … */
  key: string
  title: string
  rows: SearchRow[]
}

/** A page or tab the person may open, as the dialog lists it. */
export interface PageItem {
  id: string
  label: string
  description: string
  keywords: string[]
  path: string
  icon: string
  locked: boolean
  comingSoon: boolean
  tabs: string[]
}

/** One row per destination (a "My …" entry and the tab it opens share a route; the first wins), with each page's tabs. */
export function pageItems(entries: readonly VisibleEntry[]): PageItem[] {
  const seen = new Set<string>()
  return entries
    .filter((e) => { if (seen.has(e.path)) return false; seen.add(e.path); return true })
    .map((e) => ({
      id: e.id, label: e.label, description: e.area, path: e.path, icon: e.icon,
      keywords: [...e.keywords, ...e.area.toLowerCase().split(/[\s›&]+/).filter(Boolean)],
      locked: e.state === 'locked', comingSoon: !!e.comingSoon,
      tabs: e.parent ? [] : entries.filter((t) => t.parent === e.id && t.state === 'open').map((t) => t.label),
    }))
}

const pageRow = (item: PageItem, ranges: Range[]): SearchRow => ({
  key: `page:${item.id}`, kind: 'page', label: item.label, ranges, sub: item.description, area: item.description, path: item.path,
  icon: item.icon, kindLabel: 'Page', tabs: item.tabs,
  pill: item.comingSoon ? 'Coming soon' : item.locked ? 'Not in your plan' : undefined,
})

const actionRow = (a: QuickAction, ranges: Range[]): SearchRow => ({
  key: `action:${a.id}`, kind: 'action', label: a.label, ranges, sub: a.description, description: a.description,
  path: a.path, icon: a.icon, kindLabel: 'Action',
})

/** The status words the server puts on a record → a pill tone. */
export function badgeTone(text: string): BadgeTone {
  const s = text.toLowerCase()
  if (/reject|cancel|void|expired|withdrawn|declin|fail/.test(s)) return 'danger'
  if (/pending|waiting|awaiting|submitted|processed|review|draft/.test(s)) return 'warning'
  if (/approved|verified|paid|locked|sent|accepted|hired|reimbursed|open|signed|active/.test(s)) return 'success'
  return 'neutral'
}

/** Record types the dialog knows an icon for; anything new the server adds gets a document icon. */
export const RECORD_ICON: Record<string, string> = {
  employee: 'users', leave: 'calendarDays', expense: 'receipt', payslip: 'creditCard', document: 'fileText',
  letter: 'filePen', candidate: 'userPlus', offer: 'briefcase', job: 'briefcase', policy: 'shield', holiday: 'sun',
}
/** Payslips sit behind the Payroll module; everything else behind HRMS. */
const RECORD_MODULE: Record<string, string> = { payslip: 'payroll' }
export const recordModuleOn = (type: string, modules: readonly string[]) => modules.includes(RECORD_MODULE[type] ?? 'hrms')

export interface ResultsInput {
  query: string
  scope: Scope
  pages: readonly PageItem[]
  actions: readonly QuickAction[]
  /** The server's groups for this query (people are the `employee` group). */
  server: readonly GlobalSearchGroup[]
  /** The workspace's modules: a record behind a module that's off isn't shown (as the menu). */
  modules: readonly string[]
  /** The page on screen reads "?q=": offer to filter it. */
  onThisPage?: { label: string; path: string } | null
}

export interface Results {
  groups: SearchGroup[]
  /** Per scope; null = no number shown (nothing typed). */
  counts: Record<Scope, number | null>
  /** Records exist for this query (the Records chip shows). */
  hasRecords: boolean
}

/** How many rows each group lists: the design's caps in All, more when one scope is picked. */
export const CAPS = { all: { people: 5, pages: 6, actions: 4 }, one: { people: 5, pages: 12, actions: 8 } }

function personRow(h: GlobalSearchHit, q: string): SearchRow {
  return {
    key: `employee:${h.id}`, kind: 'person', label: h.title, ranges: highlightRanges(h.title, q), sub: h.subtitle,
    path: h.url, icon: 'users', kindLabel: 'Person', personId: h.id,
  }
}

function recordRow(g: GlobalSearchGroup, h: GlobalSearchHit, q: string): SearchRow {
  return {
    key: `${g.type}:${h.id}`, kind: 'record', label: h.title, ranges: highlightRanges(h.title, q), sub: h.subtitle, path: h.url,
    icon: RECORD_ICON[g.type] ?? 'fileText', kindLabel: g.label, recordType: g.type, recordGroup: g.label,
    badge: h.badge ? { tone: badgeTone(h.badge), text: h.badge } : undefined,
  }
}

/** The typed dialog: groups for the picked scope, and the count on every chip. */
export function buildResults(input: ResultsInput): Results {
  const q = input.query.trim().replace(/\s+/g, ' ')
  const caps = input.scope === 'all' ? CAPS.all : CAPS.one
  const allPages = rankWithRanges(input.pages, q, Number.MAX_SAFE_INTEGER)
  const allActions = rankWithRanges(input.actions, q, Number.MAX_SAFE_INTEGER)
  const people = input.server.find((g) => g.type === 'employee')?.items ?? []
  const records = input.server.filter((g) => g.type !== 'employee' && g.items.length > 0 && recordModuleOn(g.type, input.modules))
  const recordCount = records.reduce((n, g) => n + g.items.length, 0)
  const want = (s: Scope) => input.scope === 'all' || input.scope === s

  const groups: SearchGroup[] = []
  if (q && input.onThisPage && input.scope === 'all') {
    groups.push({
      key: 'filter', title: 'On this page',
      rows: [{
        key: 'filter:page', kind: 'filter', label: `Show “${q}” on ${input.onThisPage.label}`, ranges: [], sub: 'Filter the rows on this page',
        path: input.onThisPage.path, icon: 'search', kindLabel: 'Filter', area: input.onThisPage.label,
      }],
    })
  }
  if (want('people') && people.length) groups.push({ key: 'employee', title: 'People', rows: people.slice(0, caps.people).map((h) => personRow(h, q)) })
  if (want('pages') && allPages.length) groups.push({ key: 'page', title: 'Pages', rows: allPages.slice(0, caps.pages).map((r) => pageRow(r.item, r.ranges)) })
  if (want('actions') && allActions.length) groups.push({ key: 'action', title: 'Actions', rows: allActions.slice(0, caps.actions).map((r) => actionRow(r.item, r.ranges)) })
  if (want('records')) for (const g of records) groups.push({ key: g.type, title: g.label, rows: g.items.map((h) => recordRow(g, h, q)) })

  const counts: Record<Scope, number | null> = q
    ? { all: people.length + allPages.length + allActions.length + recordCount, people: people.length, pages: allPages.length, actions: allActions.length, records: recordCount }
    : { all: null, people: null, pages: null, actions: null, records: null }
  return { groups, counts, hasRecords: recordCount > 0 }
}

/** An action for the person's own self-service (applying leave, their payslip…). */
export const isSelfAction = (a: QuickAction) => a.access.some((r) => r.self || [...(r.allOf ?? []), ...(r.anyOf ?? [])].some((c) => c.endsWith('.self')))

/**
 * The empty dialog's quick-action tiles: the first six the person can complete (design: six). People
 * whose Home is the admin dashboard see the company's actions first, then their own (the design's admin row).
 */
export function quickTiles(actions: readonly QuickAction[], adminFirst = false, n = 6): QuickAction[] {
  const list = adminFirst ? [...actions.filter((a) => !isSelfAction(a)), ...actions.filter(isSelfAction)] : [...actions]
  return list.slice(0, n)
}

/** A rail module as "Jump to" lists it. */
export interface JumpModule { key: string; label: string; icon: string; group: string; soon?: boolean; pages: { label: string; path: string }[] }

/**
 * "Jump to": the first page of the person's first rail modules, in their rail's order (the design
 * lists a role's main pages; here they follow the person's own permissions). Business apps and
 * modules launching soon are left out.
 */
export function jumpRows(modules: readonly JumpModule[], iconOf: (path: string) => string | undefined, n = 5): SearchRow[] {
  const out: SearchRow[] = []
  const seen = new Set<string>()
  for (const m of modules) {
    if (m.group === 'apps' || m.soon || !m.pages.length) continue
    const p = m.pages[0]
    if (seen.has(p.path)) continue
    seen.add(p.path)
    out.push({ key: `jump:${m.key}`, kind: 'page', label: p.label, ranges: [], sub: m.label, area: m.label, path: p.path, icon: iconOf(p.path) ?? 'grid', kindLabel: 'Page' })
    if (out.length >= n) break
  }
  return out
}

/** The search pill's rolling words: only what this person can find. */
export function searchHints(ctx: AccessContext, hasActions: boolean): string[] {
  const words: string[] = []
  const hr = ctx.modules.includes('hrms')
  if (hr && ctx.has('hrms.employee.read')) words.push('people')
  if (ctx.modules.includes('payroll') && (ctx.has('payroll.runs.read') || (ctx.has('payroll.payslip.read.self') && ctx.self))) words.push('payslips')
  if (hr && ['hrms.leave.employee.read', 'hrms.leave.approve.l1', 'leave.request.self', 'leave.balance.read'].some(ctx.has)) words.push('leave requests')
  if (hr && ['hrms.document.read', 'hrms.document.read.self'].some(ctx.has)) words.push('documents')
  if (hr && ['hrms.report.headcount', 'hrms.report.attrition', 'hrms.report.attendance', 'hrms.report.leave', 'hrms.report.diversity'].some(ctx.has)) words.push('reports')
  words.push('pages')
  if (hasActions) words.push('quick actions')
  return words
}

/** "/hrms/employees/<uuid>" or the directory filtered: a person row a Recent entry may keep. */
export const PERSON_RECENT = /^\/hrms\/employees(\/[0-9a-fA-F-]{8,}|\?q=.+)$/

/** The details `/v1/search` adds for a person (by id), plus the facts a later endpoint may add. */
export interface PersonDetails extends Partial<EmployeeSearchHit> {
  branchName?: string | null
  managerName?: string | null
  dateOfJoining?: string | null
  employmentStatus?: string | null
}

/** The preview's facts: only what is known (Code today; Branch, Reports to, Joined once the server sends them). */
export function personFacts(d: PersonDetails | undefined): { k: string; v: string }[] {
  if (!d) return []
  const out: { k: string; v: string }[] = []
  if (d.employeeCode) out.push({ k: 'Code', v: d.employeeCode })
  if (d.branchName) out.push({ k: 'Branch', v: d.branchName })
  if (d.managerName) out.push({ k: 'Reports to', v: d.managerName })
  if (d.dateOfJoining) {
    const t = new Date(d.dateOfJoining + (d.dateOfJoining.length === 10 ? 'T00:00:00' : ''))
    if (!Number.isNaN(t.getTime())) out.push({ k: 'Joined', v: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })
  }
  return out
}

/** "Senior Engineer · Engineering" (whatever is set). */
export const personRole = (d: PersonDetails | undefined) => [d?.jobTitle, d?.departmentName].filter(Boolean).join(' · ')
