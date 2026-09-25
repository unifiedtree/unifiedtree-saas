import React, { useEffect, useMemo, useRef, useState } from 'react'
import { dashIcon } from '@/design/dc/icons'
import { HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useDebounce } from '../hooks/useDebounce'
import { rankWithRanges, highlightRanges, type Range } from '../search/rank'
import { useVisibleEntries } from '../navigation/useAccess'
import { useGlobalSearch, normalizeGlobalQuery, GLOBAL_SEARCH_MIN_CHARS, type GlobalSearchHit } from '../search/useGlobalSearch'

/**
 * The top bar's search: pages, people and HR records in one dropdown.
 *
 *   • Pages come from the page registry (shared/navigation), filtered by the
 *     person's permissions and the workspace's modules — the same rules as the
 *     menu. They show as soon as a letter is typed.
 *   • People and records come from `GET /v1/search/global`, which decides on
 *     the server what this person may find. Choosing one opens the page that
 *     lists it with that page's search filled in (people → the Workforce
 *     Directory), or the record's own page where the list has no search.
 *   • "Advanced search" opens the ⌘K palette (actions, recent items and "/"
 *     path navigation), carrying over what was typed.
 *
 * `variant="sheet"` is the phone layout: a full-width panel the top bar's
 * search icon opens, with the results under the box instead of a dropdown.
 */

interface TopBarSearchProps {
  /** Opens an in-app path. */
  onOpen: (path: string) => void
  /** Opens the ⌘K palette with this text. */
  onAdvanced: (query: string) => void
  variant?: 'bar' | 'sheet'
  /** Sheet only: closes the panel. */
  onClose?: () => void
}

interface Row {
  key: string
  kind: 'page' | 'person' | 'record'
  type: string
  title: string
  ranges: Range[]
  sub?: string | null
  path: string
  icon: string
  badge?: { tone: PillTone; text: string }
}
interface Group { key: string; title: string; rows: Row[] }

// The kit's own values (the palette and ModuleKit use the same).
const FONT = 'Inter,-apple-system,sans-serif'
const INK = '#0f172a', MUTED = '#64748b', FAINT = '#94a3b8', LINE = '#e2e8f0', SOFT = '#f8fafc', GREEN_BG = '#ecfdf5', GREEN = '#0f6e56', GREEN_INK = '#0a5240'
const KBD: React.CSSProperties = { fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#475569', background: '#f1f5f9', border: `1px solid ${LINE}`, borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap', lineHeight: '16px' }
const TYPE_ICON: Record<string, string> = {
  employee: 'users', leave: 'calendarDays', expense: 'receipt', payslip: 'creditCard', document: 'fileText',
  letter: 'filePen', candidate: 'userPlus', offer: 'briefcase', job: 'briefcase', policy: 'shield',
}
/** Payslips sit behind the Payroll module in the app; everything else behind HRMS. */
const TYPE_MODULE: Record<string, string> = { payslip: 'payroll' }
const MAX_PAGES = 5
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K'

function badgeTone(text: string): PillTone {
  const s = text.toLowerCase()
  if (/reject|cancel|void|expired|withdrawn|declin/.test(s)) return 'red'
  if (/pending|waiting|awaiting|submitted|processed|review/.test(s)) return 'warn'
  if (/approved|verified|paid|locked|sent|accepted|hired|reimbursed|open|signed/.test(s)) return 'ok'
  return 'gray'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Text with the matched parts marked. */
function Highlight({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let at = 0
  ranges.slice().sort((a, b) => a[0] - b[0]).forEach(([s, e], i) => {
    if (s < at) return
    if (s > at) out.push(text.slice(at, s))
    out.push(<mark key={i} style={{ background: GREEN_BG, color: GREEN_INK, borderRadius: 3, padding: '0 1px', fontWeight: 700 }}>{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

export function TopBarSearch({ onOpen, onAdvanced, variant = 'bar', onClose }: TopBarSearchProps) {
  const sheet = variant === 'sheet'
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(sheet)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounce(query, 200)

  const { ctx, entries } = useVisibleEntries()
  const q = normalizeGlobalQuery(query)
  const serverQ = normalizeGlobalQuery(debounced)
  const serverActive = serverQ.length >= GLOBAL_SEARCH_MIN_CHARS
  const server = useGlobalSearch(debounced)
  // The response for what is on screen now; while the next one loads the last one stays up.
  const data = serverActive ? server.data : undefined
  const searching = q.length >= GLOBAL_SEARCH_MIN_CHARS && (server.isFetching || debounced !== query)
  const failed = serverActive && server.isError

  useEffect(() => { if (sheet) inputRef.current?.focus() }, [sheet])

  /* Pages and tabs, one per destination (the first in registry order wins). */
  const pageItems = useMemo(() => {
    const seen = new Set<string>()
    return entries.filter((e) => { if (seen.has(e.path)) return false; seen.add(e.path); return true })
      .map((e) => ({ id: e.id, label: e.label, description: e.area, keywords: [...e.keywords, ...e.area.toLowerCase().split(/[\s›&]+/).filter(Boolean)], path: e.path, icon: e.icon, state: e.state, comingSoon: !!e.comingSoon }))
  }, [entries])

  const groups = useMemo<Group[]>(() => {
    if (!q) return []
    const out: Group[] = []
    const pages = rankWithRanges(pageItems, q, MAX_PAGES).map<Row>(({ item, ranges }) => ({
      key: `page:${item.id}`, kind: 'page', type: 'page', title: item.label, ranges, sub: item.description, path: item.path, icon: item.icon,
      badge: item.comingSoon ? { tone: 'warn', text: 'Coming soon' } : item.state === 'locked' ? { tone: 'gray', text: 'Not in your plan' } : undefined,
    }))
    if (pages.length) out.push({ key: 'page', title: 'Pages', rows: pages })
    for (const g of data?.groups ?? []) {
      if (!ctx.modules.includes(TYPE_MODULE[g.type] ?? 'hrms')) continue
      const rows = g.items.map<Row>((h: GlobalSearchHit) => ({
        key: `${g.type}:${h.id}`, kind: g.type === 'employee' ? 'person' : 'record', type: g.type, title: h.title,
        ranges: highlightRanges(h.title, serverQ), sub: h.subtitle, path: h.url, icon: TYPE_ICON[g.type] || 'fileText',
        badge: h.badge ? { tone: badgeTone(h.badge), text: h.badge } : undefined,
      }))
      if (rows.length) out.push({ key: g.type, title: g.label, rows })
    }
    return out
  }, [q, serverQ, pageItems, data, ctx.modules])

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  // A new query starts at the top, so Enter never opens a row from the previous one.
  useEffect(() => { setCursor(0) }, [query])
  useEffect(() => { if (cursor > flat.length - 1) setCursor(Math.max(0, flat.length - 1)) }, [flat.length, cursor])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor, flat.length])

  const finish = () => {
    setQuery('')
    if (sheet) onClose?.()
    else { setOpen(false); inputRef.current?.blur() }
  }
  const choose = (row: Row) => { onOpen(row.path); finish() }
  const advanced = () => { const text = query; finish(); onAdvanced(text) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true); if (flat.length) setCursor((c) => (c + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true); if (flat.length) setCursor((c) => (c - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = flat[cursor]
      if (row) choose(row)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (sheet) onClose?.()
      else if (open) setOpen(false)
      else inputRef.current?.blur()
    }
  }

  const tooShort = q.length > 0 && q.length < GLOBAL_SEARCH_MIN_CHARS
  const nothing = q.length >= GLOBAL_SEARCH_MIN_CHARS && !searching && !failed && flat.length === 0
  const activeId = open && flat[cursor] ? `tbs-row-${cursor}` : undefined
  const unavailable = (data?.unavailable ?? []).length > 0
  let flatIndex = -1

  const panel = (
    <div
      role="presentation"
      // Keep the focus in the box while a row is pressed, so the list doesn't close under the pointer.
      onMouseDown={(e) => e.preventDefault()}
      style={sheet
        ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#fff' }
        : { position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: 'max(100%, min(640px, calc(100vw - 32px)))', zIndex: 70, display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 18px 40px -12px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.06)', overflow: 'hidden' }}
    >
      <div ref={listRef} id="top-search-results" role="listbox" aria-label="Search results" data-testid="top-search-results"
        style={{ flex: sheet ? 1 : undefined, maxHeight: sheet ? undefined : 'min(64vh, 520px)', overflowY: 'auto', padding: '6px 0' }}>
        {!q && (
          <div style={{ padding: '18px 20px' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: INK }}>Search everything</p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED }}>Type a name, an employee code, a page, or a record like a leave request, payslip or document.</p>
          </div>
        )}
        {tooShort && (
          <p role="status" style={{ margin: 0, padding: '8px 18px', fontSize: 12.5, color: MUTED }}>Type {GLOBAL_SEARCH_MIN_CHARS} or more letters to search people and records.</p>
        )}

        {groups.map((g) => (
          <div key={g.key} data-result-group={g.key} role="group" aria-label={g.title} style={{ padding: '4px 0' }}>
            <div style={{ padding: '6px 18px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT }}>{g.title}</div>
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
                  data-result-type={row.type}
                  onMouseMove={() => { if (!active) setCursor(idx) }}
                  onClick={() => choose(row)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)', margin: '0 8px', padding: '8px 10px', border: 0, borderRadius: 10, textAlign: 'left', cursor: 'pointer', font: 'inherit',
                    background: active ? GREEN_BG : 'transparent', boxShadow: active ? `inset 3px 0 0 ${GREEN}` : 'none',
                  }}
                >
                  {row.kind === 'person'
                    ? <span aria-hidden style={{ display: 'inline-flex', width: 32, height: 32, flexShrink: 0, borderRadius: 999, alignItems: 'center', justifyContent: 'center', background: GREEN_BG, color: GREEN, fontSize: 11.5, fontWeight: 700 }}>{initials(row.title)}</span>
                    : <span aria-hidden style={{ display: 'inline-flex', width: 32, height: 32, flexShrink: 0, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: active ? '#fff' : SOFT, color: active ? GREEN : MUTED, border: `1px solid ${LINE}` }}>{dashIcon(row.icon || 'fileText', 16)}</span>}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 600, color: active ? GREEN_INK : INK }}>
                      <Highlight text={row.title} ranges={row.ranges} />
                    </span>
                    {row.sub ? <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: MUTED }}>{row.sub}</span> : null}
                  </span>
                  {row.badge && <HrStatusPill tone={row.badge.tone}>{row.badge.text}</HrStatusPill>}
                  {active && !sheet && <kbd aria-hidden style={{ ...KBD, background: '#fff' }}>↵</kbd>}
                </button>
              )
            })}
          </div>
        ))}

        {searching && (
          <div role="status" aria-live="polite" data-testid="top-search-loading" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', fontSize: 12.5, color: MUTED }}>
            <span aria-hidden className="animate-spin" style={{ width: 14, height: 14, borderRadius: 999, border: `2px solid ${LINE}`, borderTopColor: GREEN, display: 'inline-block' }} />
            Searching people and records…
          </div>
        )}
        {failed && (
          <div role="alert" style={{ margin: '4px 18px 8px', padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 10, background: SOFT, fontSize: 12.5, color: MUTED }}>
            People and records can’t be searched right now. Pages still work; try again in a moment.
          </div>
        )}
        {!failed && unavailable && !searching && (
          <p style={{ margin: 0, padding: '4px 18px 8px', fontSize: 12, color: MUTED }}>Some results couldn’t load this time. Try again in a moment.</p>
        )}
        {nothing && (
          <div role="status" data-testid="top-search-empty" style={{ padding: '24px 22px', textAlign: 'center' }}>
            <span aria-hidden style={{ display: 'inline-flex', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', background: SOFT, color: FAINT, marginBottom: 10 }}>{dashIcon('search', 18)}</span>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: INK }}>No results for “{q}”</p>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED }}>Try part of a name, an employee code, or a page like “leave”.</p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 16px', padding: '8px 12px 8px 18px', borderTop: `1px solid ${LINE}`, background: SOFT, fontSize: 12, color: MUTED }}>
        {sheet ? <span>Only what you can open is shown</span> : (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>↑</kbd><kbd style={KBD}>↓</kbd> move</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>↵</kbd> open</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><kbd style={KBD}>Esc</kbd> close</span>
          </span>
        )}
        <button type="button" onClick={advanced} data-testid="top-search-advanced"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', padding: '6px 8px', borderRadius: 8, font: 'inherit', fontSize: 12.5, fontWeight: 700, color: GREEN, cursor: 'pointer' }}>
          {dashIcon('search', 14)} Advanced search {!sheet && <kbd style={KBD}>{SHORTCUT}</kbd>}
        </button>
      </div>
    </div>
  )

  const box = (
    <div
      onMouseDown={(e) => { if (e.target !== inputRef.current) { e.preventDefault(); inputRef.current?.focus() } }}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, height: sheet ? 44 : 40, padding: '0 6px 0 14px', background: '#fff', borderRadius: 12, boxShadow: sheet ? `inset 0 0 0 1px ${LINE}` : '0 1px 2px rgba(0,0,0,.08)', color: MUTED, cursor: 'text' }}>
      {dashIcon('search', 17)}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search people, pages and records"
        aria-expanded={open}
        aria-controls="top-search-results"
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        data-testid="top-search-input"
        value={query}
        placeholder="Search people, leave, payslips, documents, pages…"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!sheet) setOpen(false) }}
        onKeyDown={onKeyDown}
        style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', font: 'inherit', fontFamily: FONT, fontSize: 14, color: INK, background: 'transparent' }}
      />
      {query && (
        <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}
          style={{ display: 'inline-flex', border: 0, background: 'transparent', color: FAINT, padding: 6, borderRadius: 8, cursor: 'pointer' }}>
          {dashIcon('x', 15)}
        </button>
      )}
    </div>
  )

  if (sheet) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Search" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: '#fff', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 12px', background: GREEN }}>
          {box}
          <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', color: '#fff', font: 'inherit', fontSize: 14, fontWeight: 600, padding: '10px 8px', cursor: 'pointer' }}>Cancel</button>
        </div>
        {panel}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', flex: '1 1 auto', maxWidth: 560, minWidth: 0, display: 'flex', fontFamily: FONT }}>
      {box}
      {open && panel}
    </div>
  )
}
