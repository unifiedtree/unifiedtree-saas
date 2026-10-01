// The one search dialog (design UtSearch.dc.html), opened by the top bar's search pill, ⌘K / Ctrl+K
// and the phone's search icon. It searches people, pages, actions and the HR records the person may
// open, in one box:
//   • Pages and "/" paths come from the page registry and actions from the action registry, both
//     filtered by the person's permissions and the workspace's modules (the menu's own rules).
//   • People and records come from GET /v1/search/global, which decides on the server what this
//     person may find; GET /v1/search adds a person's photo, job and department for the preview.
//   • Recent rows are kept in this browser per person and re-checked against today's permissions.
// Empty box: quick-action tiles, Recent and "Jump to". On a phone it fills the screen.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { dashIcon } from '@/design/dc/icons'
import { Avatar, StatusPill } from '@/design/kit/display'
import { useEscape, useFocusTrap, useLayer } from '@/design/kit/overlayCore'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { canOpen } from '@/shared/navigation/access'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { useVisibleEntries } from '@/shared/navigation/useAccess'
import { QUICK_ACTIONS } from '@/shared/search/actionRegistry'
import { buildSlashTargets, isSlashQuery, suggestSlash } from '@/shared/search/slash'
import { clearRecent, pushRecent, readRecent, writeRecent, type RecentItem } from '@/shared/search/recent'
import { GLOBAL_SEARCH_MIN_CHARS, normalizeGlobalQuery, useGlobalSearch } from '@/shared/search/useGlobalSearch'
import { EMPLOYEE_SEARCH_PERMISSION, normalizeEmployeeQuery, useEmployeeSearch, type EmployeeSearchHit } from '@/shared/search/useEmployeeSearch'
import type { Range } from '@/shared/search/rank'
import {
  PERSON_RECENT, buildResults, jumpRows, pageItems, personFacts, personRole, quickTiles,
  type BadgeTone, type JumpModule, type Scope, type SearchGroup, type SearchRow,
} from '@/shared/search/searchModel'
import { railGroups } from '../navModel'
import { useHome } from '../useHome'
import { useSearchStore } from './searchStore'
import './search.css'

export interface SearchDialogProps {
  /** Opens an in-app path. */
  onOpen: (path: string) => void
  /** The page on screen reads "?q=": "On this page" filters it. */
  onThisPage?: { label: string; apply: (query: string) => void } | null
}

const PHONE = '(max-width: 767px)'
const subscribePhone = (cb: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const m = window.matchMedia(PHONE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const isPhone = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches

const SCOPE_LABEL: Record<Scope, string> = { all: 'All', people: 'People', pages: 'Pages', actions: 'Actions', records: 'Records' }
const TONE: Record<BadgeTone, 'success' | 'warning' | 'danger' | 'neutral'> = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'neutral' }
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace'
const ORG_CHART = '/hrms/org-chart'

/** Text with the matched parts marked. */
function Highlight({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>
  const merged = ranges.slice().sort((a, b) => a[0] - b[0]).reduce<Range[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else acc.push([Math.max(0, r[0]), Math.min(text.length, r[1])])
    return acc
  }, [])
  const out: ReactNode[] = []
  let at = 0
  merged.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s))
    out.push(<mark key={i} className="ut-sd__mark">{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

export function SearchDialog({ onOpen, onThisPage }: SearchDialogProps) {
  const initial = useSearchStore((s) => s.initial)
  const close = useSearchStore((s) => s.closeSearch)
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false)
  const [query, setQuery] = useState(initial)
  const [scope, setScope] = useState<Scope>('all')
  const [cursor, setCursor] = useState(0)
  const debounced = useDebounce(query, 200)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const isTop = useLayer(true)
  useEscape(true, isTop, close)
  useFocusTrap(boxRef, true, isTop, inputRef)

  const { ctx, entries } = useVisibleEntries()
  const home = useHome()
  const userId = useSdkStore((s) => s.user?.id)
  const tenantId = useLocalAuthStore((s) => s.tenant?.id)
  const [recent, setRecent] = useState<RecentItem[]>(() => readRecent(tenantId, userId))

  const slashMode = isSlashQuery(query)
  const q = normalizeGlobalQuery(query)
  const pages = useMemo(() => pageItems(entries), [entries])
  const actions = useMemo(() => QUICK_ACTIONS.filter((a) => canOpen(a.access, ctx)), [ctx])
  const slashTargets = useMemo(() => buildSlashTargets(entries), [entries])

  // People and records: the server decides what this person may find.
  const serverText = slashMode ? '' : debounced
  const server = useGlobalSearch(serverText)
  const serverQ = normalizeGlobalQuery(serverText)
  const serverActive = serverQ.length >= GLOBAL_SEARCH_MIN_CHARS
  // Only the answer for what is in the box now: a stale row under a new query could be opened with Enter.
  const data = server.data && server.data.query === q.toLowerCase().slice(0, 100) ? server.data : undefined
  const searching = !slashMode && q.length >= GLOBAL_SEARCH_MIN_CHARS && (server.isFetching || debounced !== query)
  const failed = serverActive && server.isError
  const unavailable = !!data && data.unavailable.length > 0

  // A person's photo, job and department for the preview (the directory's own search; the
  // permission check only avoids a request that would be refused).
  const canSearchPeople = ctx.has(EMPLOYEE_SEARCH_PERMISSION) && ctx.modules.includes('hrms')
  const people = useEmployeeSearch(serverText, canSearchPeople && !slashMode)
  const peopleActive = canSearchPeople && normalizeEmployeeQuery(serverText).length >= 2
  const details = useMemo(() => {
    const m = new Map<string, EmployeeSearchHit>()
    if (peopleActive) for (const e of people.data?.employees ?? []) m.set(e.id, e)
    return m
  }, [peopleActive, people.data])
  const truncated = peopleActive && !people.isError && people.data?.truncated === true && !!data?.groups.some((g) => g.type === 'employee')

  // Recent rows still allowed for this person right now.
  const allowedPaths = useMemo(() => new Set([...entries.map((e) => e.path), ...actions.map((a) => a.path), ...slashTargets.map((t) => t.target.path)]), [entries, actions, slashTargets])
  const iconOf = useMemo(() => {
    const byPath = new Map(entries.map((e) => [e.path, e.icon]))
    return (path: string) => byPath.get(path)
  }, [entries])
  const recentRows = useMemo<SearchRow[]>(() => recent
    .filter((r) => (r.kind === 'person' ? canSearchPeople && PERSON_RECENT.test(r.path) : allowedPaths.has(r.path)))
    .slice(0, 5)
    .map((r) => ({
      key: `recent:${r.kind}:${r.path}`, kind: r.kind, label: r.label, ranges: [], sub: r.description, path: r.path, recent: true,
      icon: r.kind === 'person' ? 'users' : (iconOf(r.path) ?? 'clock'), kindLabel: 'Recent', area: r.description,
      personId: r.kind === 'person' ? r.path.match(/\/hrms\/employees\/([0-9a-fA-F-]{8,})$/)?.[1] : undefined,
    })),
  [recent, canSearchPeople, allowedPaths, iconOf])
  const jump = useMemo(() => {
    const mods: JumpModule[] = railGroups(ctx, { selfFirst: home.kind !== 'admin' })
      .flatMap((g) => g.modules.map((m) => ({ key: m.key, label: m.name, icon: m.icon, group: g.key, pages: m.pages })))
    const recentPaths = new Set(recentRows.map((r) => r.path))
    return jumpRows(mods, iconOf).filter((r) => !recentPaths.has(r.path))
  }, [ctx, home.kind, iconOf, recentRows])

  const results = useMemo(() => buildResults({
    query: q, scope, pages, actions, server: data?.groups ?? [], modules: ctx.modules,
    onThisPage: onThisPage ? { label: onThisPage.label, path: '' } : null,
  }), [q, scope, pages, actions, data, ctx.modules, onThisPage])

  const groups = useMemo<SearchGroup[]>(() => {
    if (slashMode) {
      const hits = suggestSlash(q, slashTargets, q === '/' ? 40 : 8)
      return [{
        key: 'goto', title: q === '/' ? 'Areas you can open' : 'Go to',
        rows: hits.map((h) => ({
          key: `goto:${h.target.id}`, kind: 'page' as const, label: h.target.label, ranges: [], sub: h.target.trail, area: h.target.trail,
          slashText: h.shown, slashRanges: h.ranges, path: h.target.path, icon: h.target.icon, kindLabel: 'Page',
          complete: '/' + h.target.slash + (h.target.isModule ? '/' : ''),
          pill: h.target.comingSoon ? 'Coming soon' : h.target.locked ? 'Not in your plan' : undefined,
        })),
      }]
    }
    if (!q) {
      const out: SearchGroup[] = []
      if (recentRows.length) out.push({ key: 'recent', title: 'Recent', rows: recentRows })
      if (jump.length) out.push({ key: 'jump', title: 'Jump to', rows: jump })
      return out
    }
    return results.groups
  }, [slashMode, q, slashTargets, recentRows, jump, results.groups])

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  // A new query or scope starts at the top, so Enter never opens a row from the previous one.
  useEffect(() => { setCursor(0) }, [query, scope])
  useEffect(() => { if (cursor > flat.length - 1) setCursor(Math.max(0, flat.length - 1)) }, [flat.length, cursor])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor, flat.length])
  // The Records chip goes when this query has none.
  useEffect(() => { if (scope === 'records' && !results.hasRecords && !searching) setScope('all') }, [scope, results.hasRecords, searching])

  const current = flat[cursor]

  const remember = (row: SearchRow) => {
    if (row.kind !== 'person' && row.kind !== 'page' && row.kind !== 'action') return
    const next = pushRecent(recent, { kind: row.kind, id: row.key, label: row.label, description: row.sub ?? undefined, path: row.path, at: Date.now() })
    setRecent(next)
    writeRecent(tenantId, userId, next)
  }
  const go = (row: SearchRow, path = row.path) => {
    if (row.kind === 'filter') { onThisPage?.apply(q); close(); return }
    remember(row)
    close()
    onOpen(path)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setCursor((c) => (c + 1) % flat.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setCursor((c) => (c - 1 + flat.length) % flat.length) }
    else if (e.key === 'Enter') { e.preventDefault(); if (current) go(current) }
    else if (e.key === 'Tab' && slashMode && !e.shiftKey && current?.complete) { e.preventDefault(); setQuery(current.complete) }
  }

  const tooShort = !slashMode && q.length > 0 && q.length < GLOBAL_SEARCH_MIN_CHARS
  const nothing = !!q && !searching && !failed && flat.length === 0
  const scopes: Scope[] = ['all', 'people', 'pages', 'actions', ...(results.hasRecords || scope === 'records' ? ['records' as const] : [])]
  const tiles = quickTiles(actions, home.kind === 'admin')
  const orgChartLive = PAGE_REGISTRY.some((e) => e.path.split('?')[0] === ORG_CHART)
  const activeId = current ? `tbs-row-${cursor}` : undefined
  let flatIndex = -1

  const preview = current && !phone ? <Preview row={current} details={current.personId ? details.get(current.personId) : undefined} orgChart={orgChartLive} onGo={go} /> : null

  return createPortal(
    <div className="uko-layer ut-sd-layer" style={{ zIndex: 1100 }} data-uko-layer="">
      <div className="uko-backdrop" aria-hidden="true" onClick={close} />
      <div className="ut-sd-wrap">
        <div ref={boxRef} role="dialog" aria-modal="true" aria-label="Search" className="ut-sd" data-phone={phone ? '' : undefined} tabIndex={-1}>
          <div className="ut-sd__head">
            <span className="ut-sd__glyph" aria-hidden="true">{dashIcon(slashMode ? 'hash' : 'search', 19)}</span>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label={canSearchPeople ? 'Search people, pages, actions and records' : 'Search pages, actions and records'}
              aria-expanded={flat.length > 0}
              aria-controls="top-search-results"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              data-testid="top-search-input"
              className="ut-sd__input"
              value={query}
              placeholder={phone ? 'Search everything' : 'Search people, pages and actions'}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              style={slashMode ? { fontFamily: MONO } : undefined}
            />
            {slashMode && <StatusPill tone="brand" size="sm">Go to page</StatusPill>}
            {query && <button type="button" className="ut-sd__clear" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear search">Clear</button>}
            {phone
              ? <button type="button" className="ut-sd__cancel" onClick={close}>Cancel</button>
              : <kbd className="ut-sd__esc">Esc</kbd>}
          </div>

          {!slashMode && (
            <div className="ut-sd__scopes" role="group" aria-label="Search in">
              {scopes.map((s) => {
                const n = results.counts[s]
                return (
                  <button key={s} type="button" className="ut-sd__scope" aria-pressed={scope === s} onClick={() => { setScope(s); inputRef.current?.focus() }}>
                    {SCOPE_LABEL[s]}{n != null && !searching && <span className="ut-sd__scopen">{s === 'people' && truncated ? `${n}+` : n}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {!q && tiles.length > 0 && (
            <div className="ut-sd__quick">
              <div className="ut-sd__label">Quick actions</div>
              <div className="ut-sd__tiles">
                {tiles.map((a) => (
                  <button key={a.id} type="button" className="ut-sd__tile" onClick={() => go({ key: `action:${a.id}`, kind: 'action', label: a.label, ranges: [], sub: a.description, path: a.path, icon: a.icon, kindLabel: 'Action' })}>
                    <span className="ut-sd__tileicon" aria-hidden="true">{dashIcon(a.icon, 17)}</span>
                    <span className="ut-sd__tilelabel">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ut-sd__body">
            <div ref={listRef} id="top-search-results" role="listbox" aria-label="Search results" data-testid="top-search-results" className="ut-sd__list">
              {tooShort && <p role="status" className="ut-sd__note">Type {GLOBAL_SEARCH_MIN_CHARS} or more letters to search people and records.</p>}
              {groups.map((g) => (
                <div key={g.key} data-result-group={g.key} role="group" aria-label={g.title} className="ut-sd__group">
                  <div className="ut-sd__ghead">
                    <span>{g.title}</span>
                    {g.key === 'recent' && (
                      <button type="button" className="ut-sd__gclear" onClick={() => { clearRecent(tenantId, userId); setRecent([]); inputRef.current?.focus() }}>Clear</button>
                    )}
                  </div>
                  {g.rows.map((row) => {
                    flatIndex += 1
                    const idx = flatIndex
                    const active = idx === cursor
                    return (
                      <button
                        key={row.key}
                        id={`tbs-row-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-active={active}
                        data-result-type={row.kind === 'person' ? 'employee' : row.kind === 'record' ? row.recordType : row.kind}
                        className="ut-sd__row"
                        onMouseMove={() => { if (!active) setCursor(idx) }}
                        onClick={() => go(row)}
                      >
                        {row.kind === 'person'
                          ? <Avatar name={row.label} src={row.personId ? details.get(row.personId)?.profilePhotoUrl : undefined} size={34} tone="pale" decorative />
                          : <span className={row.kind === 'action' ? 'ut-sd__ricon ut-sd__ricon--solid' : 'ut-sd__ricon'} aria-hidden="true">{dashIcon(row.icon || 'fileText', 16)}</span>}
                        <span className="ut-sd__rtext">
                          <span className="ut-sd__rtitle"><Highlight text={row.label} ranges={row.ranges} /></span>
                          {row.slashText
                            ? <span className="ut-sd__rsub"><span className="ut-sd__slash"><Highlight text={row.slashText} ranges={row.slashRanges ?? []} /></span>{row.sub ? ` · ${row.sub}` : ''}</span>
                            : row.sub ? <span className="ut-sd__rsub">{row.sub}</span> : null}
                        </span>
                        {row.badge && <StatusPill tone={TONE[row.badge.tone]} size="sm">{row.badge.text}</StatusPill>}
                        {row.pill && <StatusPill tone={row.pill === 'Coming soon' ? 'warning' : 'neutral'} size="sm">{row.pill}</StatusPill>}
                        {active
                          ? <span className="ut-sd__open" aria-hidden="true">Open<kbd>↵</kbd></span>
                          : !row.badge && !row.pill && <span className="ut-sd__kind" aria-hidden="true">{row.kindLabel}</span>}
                      </button>
                    )
                  })}
                  {g.key === 'employee' && truncated && (
                    <p data-testid="employee-search-truncated" className="ut-sd__note">Showing the first {people.data?.limit ?? g.rows.length} people. Keep typing to narrow it down.</p>
                  )}
                </div>
              ))}
              {searching && (
                <div role="status" aria-live="polite" data-testid="top-search-loading" className="ut-sd__loading">
                  <span aria-hidden="true" className="ut-sd__spin" />Searching people and records…
                </div>
              )}
              {failed && (
                <div role="alert" className="ut-sd__alert">People and records can’t be searched right now. Pages and actions still work; try again in a moment.</div>
              )}
              {!failed && unavailable && !searching && <p className="ut-sd__note">Some results couldn’t load this time. Try again in a moment.</p>}
              {nothing && (
                <div role="status" data-testid="top-search-empty" className="ut-sd__none">
                  {slashMode ? (
                    <>
                      <div className="ut-sd__nonet">No page at “{q}” that you can open</div>
                      <div className="ut-sd__noneh">Type / on its own to see every area you can open.</div>
                    </>
                  ) : (
                    <>
                      <div className="ut-sd__nonet">Nothing found for “{q}”</div>
                      <div className="ut-sd__noneh">
                        {canSearchPeople
                          ? 'Try part of a name, an employee code, or a page such as payslips.'
                          : 'Try a page such as payslips, or type / to browse. Searching for a person needs Workforce Directory access.'}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {preview}
          </div>

          <div className="ut-sd__foot">
            {phone ? <span>Only what you can open is shown</span> : (
              <span className="ut-sd__keys">
                <span><kbd>↑</kbd><kbd>↓</kbd>move</span>
                <span><kbd>↵</kbd>open</span>
                {slashMode ? <span><kbd>Tab</kbd>complete path</span> : <span><kbd>/</kbd>go to a page</span>}
                <span><kbd>Esc</kbd>close</span>
              </span>
            )}
            <span className="ut-sd__every">Searching every module</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The right-hand preview of the highlighted row, with its main action. */
function Preview({ row, details, orgChart, onGo }: { row: SearchRow; details?: EmployeeSearchHit; orgChart: boolean; onGo: (row: SearchRow, path?: string) => void }) {
  let body: ReactNode
  let cta = 'Open'
  let path = row.path
  if (row.kind === 'person') {
    const facts = personFacts(details)
    const role = personRole(details)
    // The row opens the directory filtered to them (as the search always has); the preview opens their profile.
    if (row.personId) { cta = 'Open profile'; path = `/hrms/employees/${row.personId}` }
    body = (
      <div className="ut-sdp__person">
        <Avatar name={row.label} src={details?.profilePhotoUrl} size={60} tone="solid" ring="brand" decorative />
        <div>
          <div className="ut-sdp__title">{row.label}</div>
          {(details ? role : row.sub) && <div className="ut-sdp__role">{details ? role : row.sub}</div>}
        </div>
        {facts.length > 0 && (
          <dl className="ut-sdp__facts">
            {facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
          </dl>
        )}
        {orgChart && row.personId && (
          <button type="button" className="ut-sdp__link" onClick={() => onGo(row, `${ORG_CHART}?focus=${row.personId}`)}>View in org chart</button>
        )}
      </div>
    )
  } else if (row.kind === 'page') {
    cta = 'Open page'
    body = (
      <div className="ut-sdp__block">
        <span className="ut-sdp__icon" aria-hidden="true">{dashIcon(row.icon || 'grid', 22)}</span>
        <div>
          {row.area && <div className="ut-sdp__over">{row.area}</div>}
          <div className="ut-sdp__title">{row.label}</div>
        </div>
        {!!row.tabs?.length && <div className="ut-sdp__tabs">{row.tabs.map((t) => <span key={t}>{t}</span>)}</div>}
      </div>
    )
  } else if (row.kind === 'action') {
    cta = 'Run action'
    body = (
      <div className="ut-sdp__block">
        <span className="ut-sdp__icon ut-sdp__icon--solid" aria-hidden="true">{dashIcon(row.icon || 'arrowRight', 22)}</span>
        <div>
          <div className="ut-sdp__over">Action</div>
          <div className="ut-sdp__title">{row.label}</div>
        </div>
        {(row.description || row.sub) && <div className="ut-sdp__desc">{row.description || row.sub}</div>}
      </div>
    )
  } else if (row.kind === 'filter') {
    cta = 'Filter this page'
    body = (
      <div className="ut-sdp__block">
        <span className="ut-sdp__icon ut-sdp__icon--gold" aria-hidden="true">{dashIcon('search', 22)}</span>
        <div>
          <div className="ut-sdp__over">This page</div>
          <div className="ut-sdp__title">{row.area}</div>
        </div>
        <div className="ut-sdp__desc">Keeps you on this page and shows only rows that match. Clear it from the chip next to the search.</div>
      </div>
    )
  } else {
    body = (
      <div className="ut-sdp__block">
        <span className="ut-sdp__icon" aria-hidden="true">{dashIcon(row.icon || 'fileText', 22)}</span>
        <div>
          <div className="ut-sdp__over">{row.recordGroup}</div>
          <div className="ut-sdp__title">{row.label}</div>
        </div>
        {row.sub && <div className="ut-sdp__desc">{row.sub}</div>}
        {row.badge && <StatusPill tone={TONE[row.badge.tone]} size="md" dot>{row.badge.text}</StatusPill>}
      </div>
    )
  }
  return (
    <aside aria-label="Preview" className="ut-sdp">
      {body}
      <button type="button" className="ut-sdp__cta" onClick={() => onGo(row, path)}>
        {cta}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </aside>
  )
}
