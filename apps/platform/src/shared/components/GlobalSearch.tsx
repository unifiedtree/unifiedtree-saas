import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { dashIcon } from '@/design/dc/icons'
import { HrStatusPill } from '@/shared/components/hr'
import { useDebounce } from '../hooks/useDebounce'
import { QUICK_ACTIONS } from '../search/actionRegistry'
import { rankWithRanges, highlightRanges, type Range, type Searchable } from '../search/rank'
import { buildSlashTargets, isSlashQuery, suggestSlash } from '../search/slash'
import { readRecent, writeRecent, pushRecent, clearRecent, type RecentItem } from '../search/recent'
import { canOpen } from '../navigation/access'
import { useVisibleEntries } from '../navigation/useAccess'
import {
  useEmployeeSearch, normalizeEmployeeQuery,
  EMPLOYEE_SEARCH_MIN_CHARS, EMPLOYEE_SEARCH_PERMISSION,
  type EmployeeSearchHit,
} from '../search/useEmployeeSearch'

/**
 * The ⌘K palette: people, pages (every page and sub-tab the person may
 * open), actions and recent items, plus "/" path navigation.
 *
 * Nothing here is invented or fetched to be filtered client-side:
 *   • Pages and "/" paths come from the page registry (shared/navigation),
 *     filtered by the person's permissions and the workspace's modules — the
 *     same rules as the menu.
 *   • Actions come from `actionRegistry`, filtered the same way.
 *   • People come from `GET /v1/search`, which applies the Workforce
 *     Directory's own gate (`hrms.employee.read` + tenant RLS) on the server.
 *     This component only sends what was typed.
 *   • Recent items are kept in this browser per person, and re-checked
 *     against the current permissions before they're shown.
 */

export type SearchResultType = 'action' | 'page' | 'employee'

export interface SearchResult extends Searchable {
  type: SearchResultType
  path: string
  category?: string
  /** People only: profile photo, when the employee has one. */
  avatarUrl?: string | null
}

interface GlobalSearchProps {
  onSelect?: (result: SearchResult) => void
  /** Text to start with (the top bar's "Advanced search" carries over what was typed there). */
  initialQuery?: string
}

type GroupKey = 'recent' | 'suggested' | 'goto' | 'page' | 'action' | 'employee'
interface Row {
  key: string
  kind: 'person' | 'page' | 'action'
  label: string
  ranges: Range[]
  sub?: string
  /** "/" mode: the path shown instead of the label's subtitle. */
  slashText?: string
  slashRanges?: Range[]
  path: string
  icon: string
  avatarUrl?: string | null
  pill?: { tone: 'gray' | 'warn'; text: string }
  /** Tab completes the input to this ("/" mode). */
  complete?: string
}
interface Group { key: GroupKey; title: string; rows: Row[]; aside?: React.ReactNode; status?: React.ReactNode }

// Design tokens (the kit's own values: ModuleKit / the design's chrome).
const FONT = 'Inter,-apple-system,sans-serif'
const INK = '#0f172a', MUTED = '#64748b', FAINT = '#94a3b8', LINE = '#e2e8f0', SOFT = '#f8fafc', GREEN_BG = '#ecfdf5', GREEN = '#0f6e56', GREEN_INK = '#0a5240'
const KBD: React.CSSProperties = { fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#475569', background: '#f1f5f9', border: `1px solid ${LINE}`, borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap', lineHeight: '16px' }
const GROUP_TITLE: Record<GroupKey, string> = { recent: 'Recent', suggested: 'Suggested for you', goto: 'Go to', page: 'Pages', action: 'Actions', employee: 'People' }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** "EMP-0042 · Engineering · Senior Engineer", dropping whatever is unset. */
function hitSubtitle(e: EmployeeSearchHit): string {
  return [e.employeeCode, e.departmentName, e.jobTitle].filter(Boolean).join(' · ')
}

/** Text with the matched parts marked. */
function Highlight({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>
  const merged = ranges.slice().sort((a, b) => a[0] - b[0]).reduce<Range[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else acc.push([Math.max(0, r[0]), Math.min(text.length, r[1])])
    return acc
  }, [])
  const out: React.ReactNode[] = []
  let at = 0
  merged.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s))
    out.push(<mark key={i} style={{ background: GREEN_BG, color: GREEN_INK, borderRadius: 3, padding: '0 1px', fontWeight: 700 }}>{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

const PERSON_PATH = /^\/hrms\/employees\/[0-9a-fA-F-]{8,}$/

export function GlobalSearch({ onSelect, initialQuery }: GlobalSearchProps) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [cursor, setCursor] = useState(0)
  const debouncedQuery = useDebounce(query, 150)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { ctx, entries } = useVisibleEntries()
  const userId = useSdkStore((s) => s.user?.id)
  const tenantId = useLocalAuthStore((s) => s.tenant?.id)
  const [recent, setRecent] = useState<RecentItem[]>(() => readRecent(tenantId, userId))
  useEffect(() => { setRecent(readRecent(tenantId, userId)) }, [tenantId, userId])

  const slashMode = isSlashQuery(query)
  const q = query.trim()

  /* Pages and tabs, one per destination (a "My …" entry and the tab it
     opens share a route; the first in registry order wins). */
  const pageItems = useMemo(() => {
    const seen = new Set<string>()
    return entries.filter((e) => { if (seen.has(e.path)) return false; seen.add(e.path); return true })
      .map((e) => ({ id: e.id, label: e.label, description: e.area, keywords: [...e.keywords, ...e.area.toLowerCase().split(/[\s›&]+/).filter(Boolean)], path: e.path, icon: e.icon, state: e.state, comingSoon: !!e.comingSoon }))
  }, [entries])
  const actions = useMemo(() => QUICK_ACTIONS.filter((a) => canOpen(a.access, ctx)), [ctx])
  const slashTargets = useMemo(() => buildSlashTargets(entries), [entries])

  /* People. The permission check isn't the control (the endpoint enforces
     it); it only avoids sending a request that would 403 on every keystroke. */
  const canSearchPeople = ctx.has(EMPLOYEE_SEARCH_PERMISSION) && ctx.modules.includes('hrms')
  const peopleText = slashMode ? '' : debouncedQuery
  const peopleQuery = normalizeEmployeeQuery(peopleText)
  const peopleActive = canSearchPeople && peopleQuery.length >= EMPLOYEE_SEARCH_MIN_CHARS
  const people = useEmployeeSearch(peopleText, canSearchPeople && !slashMode)
  const peopleHits = useMemo<EmployeeSearchHit[]>(() => (peopleActive ? people.data?.employees ?? [] : []), [peopleActive, people.data])
  const peopleError = peopleActive && people.isError
  const peopleLoading = peopleActive && people.isFetching
  const peopleTruncated = peopleActive && !people.isError && people.data?.truncated === true

  // Recent items still allowed for this person right now.
  const allowedPaths = useMemo(() => new Set([...entries.map((e) => e.path), ...actions.map((a) => a.path), ...slashTargets.map((t) => t.target.path)]), [entries, actions, slashTargets])
  const recentRows = useMemo<Row[]>(() => recent
    .filter((r) => (r.kind === 'person' ? canSearchPeople && PERSON_PATH.test(r.path) : allowedPaths.has(r.path)))
    .map((r) => ({ key: `recent:${r.kind}:${r.path}`, kind: r.kind, label: r.label, ranges: [], sub: r.description, path: r.path, icon: r.kind === 'person' ? '' : r.kind === 'action' ? 'arrowRight' : 'clock' })),
  [recent, canSearchPeople, allowedPaths])

  const groups = useMemo<Group[]>(() => {
    if (slashMode) {
      const hits = suggestSlash(q, slashTargets, q === '/' ? 40 : 8)
      return [{
        key: 'goto', title: q === '/' ? 'Areas you can open' : 'Go to',
        rows: hits.map((h) => ({
          key: `goto:${h.target.id}`, kind: 'page', label: h.target.label, ranges: [], sub: h.target.trail, slashText: h.shown, slashRanges: h.ranges,
          path: h.target.path, icon: h.target.icon, complete: '/' + h.target.slash + (h.target.isModule ? '/' : ''),
          pill: h.target.comingSoon ? { tone: 'warn', text: 'Coming soon' } : h.target.locked ? { tone: 'gray', text: 'Not in your plan' } : undefined,
        })),
      }]
    }
    if (!q) {
      const out: Group[] = []
      if (recentRows.length) out.push({ key: 'recent', title: GROUP_TITLE.recent, rows: recentRows })
      const suggested = actions.slice(0, 4).map<Row>((a) => ({ key: `suggest:${a.id}`, kind: 'action', label: a.label, ranges: [], sub: a.description, path: a.path, icon: a.icon }))
      if (suggested.length) out.push({ key: 'suggested', title: GROUP_TITLE.suggested, rows: suggested })
      return out
    }
    const pageRows = rankWithRanges(pageItems, q, 8).map<Row>(({ item, ranges }) => ({
      key: `page:${item.id}`, kind: 'page', label: item.label, ranges, sub: item.description, path: item.path, icon: item.icon,
      pill: item.comingSoon ? { tone: 'warn', text: 'Coming soon' } : item.state === 'locked' ? { tone: 'gray', text: 'Not in your plan' } : undefined,
    }))
    const actionRows = rankWithRanges(actions, q, 5).map<Row>(({ item, ranges }) => ({ key: `action:${item.id}`, kind: 'action', label: item.label, ranges, sub: item.description, path: item.path, icon: item.icon }))
    // The server already ranked (exact → prefix → substring) and bounded the people hits.
    const personRows = peopleHits.map<Row>((e) => ({
      key: `emp:${e.id}`, kind: 'person', label: e.displayName, ranges: highlightRanges(e.displayName, peopleQuery), sub: hitSubtitle(e),
      path: `/hrms/employees/${e.id}`, icon: '', avatarUrl: e.profilePhotoUrl,
    }))
    const out: Group[] = []
    if (pageRows.length) out.push({ key: 'page', title: GROUP_TITLE.page, rows: pageRows })
    if (actionRows.length) out.push({ key: 'action', title: GROUP_TITLE.action, rows: actionRows })
    // The People group also shows with no rows when it has something to say (searching, failed, too many).
    if (personRows.length || peopleLoading || peopleError || peopleTruncated) out.push({ key: 'employee', title: GROUP_TITLE.employee, rows: personRows })
    return out
  }, [slashMode, q, slashTargets, recentRows, actions, pageItems, peopleHits, peopleQuery, peopleLoading, peopleError, peopleTruncated])

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  // Reset the highlight whenever the query changes, so Enter never fires a stale row.
  useEffect(() => { setCursor(0) }, [query])
  useEffect(() => { if (cursor > flat.length - 1) setCursor(Math.max(0, flat.length - 1)) }, [flat.length, cursor])
  // Keep the highlighted row inside the scroll viewport during keyboard navigation.
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor, flat.length])

  const choose = (row: Row) => {
    const next = pushRecent(recent, { kind: row.kind, id: row.key, label: row.label, description: row.sub, path: row.path, at: Date.now() })
    setRecent(next)
    writeRecent(tenantId, userId, next)
    onSelect?.({ id: row.key, type: row.kind === 'person' ? 'employee' : row.kind, label: row.label, description: row.sub, path: row.path, avatarUrl: row.avatarUrl })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); if (flat.length) setCursor((c) => (c + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); if (flat.length) setCursor((c) => (c - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = flat[cursor]
      if (row) choose(row)
    } else if (e.key === 'Tab' && slashMode && !e.shiftKey) {
      // Complete the path to the highlighted suggestion ("/att" → "/attendance/").
      const row = flat[cursor]
      if (row?.complete) { e.preventDefault(); setQuery(row.complete) }
    }
    // Escape isn't handled here: the shell closes the palette on Escape wherever focus is.
  }

  const example = useMemo(() => slashTargets.find((t) => !t.target.id.startsWith('area:') && t.target.slash.includes('/'))?.target.slash, [slashTargets])
  const placeholder = canSearchPeople ? 'Search people, pages and actions, or type / to go to a page' : 'Search pages and actions, or type / to go to a page'
  const activeId = flat[cursor] ? `gs-row-${cursor}` : undefined
  const noResults = !!q && flat.length === 0 && !peopleLoading && !peopleError
  let flatIndex = -1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: FONT, color: INK }}>
      {/* The search row is the focus affordance, so the input itself draws no outline. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>
        <span aria-hidden style={{ display: 'inline-flex', width: 36, height: 36, flexShrink: 0, borderRadius: 10, alignItems: 'center', justifyContent: 'center', background: GREEN_BG, color: GREEN }}>
          {dashIcon(slashMode ? 'hash' : 'search', 17)}
        </span>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="global-search-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', font: 'inherit', fontSize: 15, color: INK, fontFamily: slashMode ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : FONT }}
        />
        {slashMode && <HrStatusPill tone="ok">Go to page</HrStatusPill>}
        {query ? (
          <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear search"
            style={{ display: 'inline-flex', border: 0, background: 'transparent', color: FAINT, padding: 4, borderRadius: 6, cursor: 'pointer' }}>
            {dashIcon('x', 16)}
          </button>
        ) : <kbd style={KBD}>Esc</kbd>}
      </div>

      <div ref={listRef} id="global-search-results" role="listbox" aria-label="Search results" style={{ maxHeight: 'min(60vh, 460px)', overflowY: 'auto', padding: '6px 0' }}>
        {!q && !groups.length && (
          <div style={{ padding: '28px 24px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Start typing to jump anywhere</p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED }}>Type a {canSearchPeople ? 'name, ' : ''}page or task.</p>
          </div>
        )}

        {noResults && (
          <div role="status" style={{ padding: '28px 24px', textAlign: 'center' }}>
            <span aria-hidden style={{ display: 'inline-flex', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', background: SOFT, color: FAINT, marginBottom: 10 }}>{dashIcon('search', 18)}</span>
            {slashMode ? (
              <>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>No page at “{q}” that you can open</p>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED }}>Type / on its own to see every area you can open.</p>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>No matches for “{q}”</p>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED }}>
                  {canSearchPeople
                    ? peopleQuery.length < EMPLOYEE_SEARCH_MIN_CHARS ? `Type at least ${EMPLOYEE_SEARCH_MIN_CHARS} characters to search people.` : 'Try part of a name, an employee code, or a page like “leave”.'
                    // Honest about the boundary: "no results" alone would read as "no such employee".
                    : 'Searching for a person? People search needs Workforce Directory access. Try a page like “leave”, or type / to browse.'}
                </p>
              </>
            )}
          </div>
        )}

        {groups.map((g) => {
          const isPeople = g.key === 'employee'
          return (
            <div key={g.key} data-result-group={g.key} role="group" aria-label={g.title} style={{ padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 18px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT }}>
                <span>{g.title}</span>
                {isPeople && peopleLoading && <span aria-live="polite" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Searching…</span>}
                {g.key === 'recent' && (
                  <button type="button" onClick={() => { clearRecent(tenantId, userId); setRecent([]); inputRef.current?.focus() }}
                    style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 11.5, fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: GREEN, cursor: 'pointer' }}>
                    Clear
                  </button>
                )}
              </div>
              {isPeople && peopleError && (
                <div role="alert" data-testid="employee-search-error" style={{ margin: '2px 18px 6px', padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 10, background: SOFT, fontSize: 12.5, color: MUTED }}>
                  People search is unavailable right now. Pages and actions still work; try again in a moment.
                </div>
              )}
              {g.rows.map((row) => {
                flatIndex += 1
                const idx = flatIndex
                const active = idx === cursor
                return (
                  <button
                    key={row.key}
                    id={`gs-row-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    data-result-type={row.kind === 'person' ? 'employee' : row.kind}
                    onMouseMove={() => { if (!active) setCursor(idx) }}
                    onClick={() => choose(row)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)', margin: '0 8px', padding: '8px 10px', border: 0, borderRadius: 10, textAlign: 'left', cursor: 'pointer', font: 'inherit',
                      background: active ? GREEN_BG : 'transparent', boxShadow: active ? `inset 3px 0 0 ${GREEN}` : 'none',
                    }}
                  >
                    {row.kind === 'person' ? (
                      row.avatarUrl
                        ? <img src={row.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
                        : <span aria-hidden style={{ display: 'inline-flex', width: 32, height: 32, flexShrink: 0, borderRadius: 999, alignItems: 'center', justifyContent: 'center', background: GREEN_BG, color: GREEN, fontSize: 11.5, fontWeight: 700 }}>{initials(row.label)}</span>
                    ) : (
                      <span aria-hidden style={{
                        display: 'inline-flex', width: 32, height: 32, flexShrink: 0, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                        background: row.kind === 'action' ? GREEN : active ? '#fff' : SOFT, color: row.kind === 'action' ? '#fff' : active ? GREEN : MUTED, border: row.kind === 'action' ? 0 : `1px solid ${LINE}`,
                      }}>{dashIcon(row.icon || 'fileText', 16)}</span>
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 600, color: active ? GREEN_INK : INK }}>
                        <Highlight text={row.label} ranges={row.ranges} />
                      </span>
                      {row.slashText ? (
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: MUTED }}>
                          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', color: active ? GREEN_INK : '#475569' }}><Highlight text={row.slashText} ranges={row.slashRanges ?? []} /></span>
                          {row.sub ? <span> · {row.sub}</span> : null}
                        </span>
                      ) : row.sub ? (
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: MUTED }}>{row.sub}</span>
                      ) : null}
                    </span>
                    {row.pill && <HrStatusPill tone={row.pill.tone}>{row.pill.text}</HrStatusPill>}
                    {active && <kbd aria-hidden style={{ ...KBD, background: '#fff' }}>↵</kbd>}
                  </button>
                )
              })}
              {isPeople && peopleTruncated && (
                <p data-testid="employee-search-truncated" style={{ margin: 0, padding: '4px 18px 6px', fontSize: 12, color: MUTED }}>
                  Showing the first {people.data?.limit ?? g.rows.length} people. Keep typing to narrow it down.
                </p>
              )}
            </div>
          )
        })}

        {!q && example && (
          <p style={{ margin: '6px 18px 8px', padding: '10px 12px', borderRadius: 10, background: SOFT, border: `1px dashed ${LINE}`, fontSize: 12.5, color: MUTED }}>
            Tip: type <kbd style={KBD}>/</kbd> to go straight to a page, e.g. <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', color: GREEN_INK }}>/{example}</span>
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 16px', padding: '9px 18px', borderTop: `1px solid ${LINE}`, background: SOFT, fontSize: 12, color: MUTED }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>↑</kbd><kbd style={KBD}>↓</kbd> move</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>↵</kbd> open</span>
          {slashMode
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>Tab</kbd> complete path</span>
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>/</kbd> go to a page</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>Esc</kbd> close</span>
        </span>
        <span aria-live="polite">{q ? `${flat.length} ${flat.length === 1 ? 'result' : 'results'}` : 'Only what you can open is shown'}</span>
      </div>
    </div>
  )
}
