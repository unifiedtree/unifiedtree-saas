import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useAuthStore } from '@unifiedtree/sdk'
import { useDebounce } from '../hooks/useDebounce'
import { QUICK_ACTIONS } from '../search/actionRegistry'
import { rank, type Searchable } from '../search/rank'
import {
  useEmployeeSearch, normalizeEmployeeQuery,
  EMPLOYEE_SEARCH_MIN_CHARS, EMPLOYEE_SEARCH_PERMISSION,
  type EmployeeSearchHit,
} from '../search/useEmployeeSearch'

/**
 * ⌘K palette — quick actions and pages.
 *
 * Global search over INVENTED data ("Alice Martin", "Acme Corp Lead $45,000")
 * was reported live in a real customer's panel on 2026-08-10. The mock data was
 * deleted and the component was left returning `[]` — which meant the one
 * feature built to stop users hunting through the sidebar did nothing at all
 * for six weeks.
 *
 * This restores it WITHOUT inventing anything:
 *   • Pages come from the live navigation tree, passed in by PlatformShell,
 *     already filtered by the shell's own role check. One source of truth —
 *     there is no second list of routes to drift.
 *   • Actions come from `actionRegistry`, filtered here against the SDK's
 *     permission map.
 *
 *   • People come from `GET /v1/search` (Milestone 4C), which applies the
 *     Workforce Directory's own gate — `hrms.employee.read` + tenant RLS —
 *     on the server. This component never fetches a list to filter; it sends
 *     the typed query and renders the hits. Do NOT reintroduce a client-side
 *     employee list here — that is how the 2026-08-10 incident happened.
 *
 * Documents and payslips are still not searched here.
 */

export type SearchResultType = 'action' | 'page' | 'employee'

export interface SearchResult extends Searchable {
  type: SearchResultType
  path: string
  category?: string
  /** People only: profile photo, when the employee has one. */
  avatarUrl?: string | null
}

/** A page the current user is allowed to open. Built by PlatformShell. */
export interface SearchPage {
  id: string
  label: string
  path: string
  /** Parent nav group, e.g. "Attendance & Time". Shown as the subtitle. */
  group?: string
  keywords?: string[]
}

interface GlobalSearchProps {
  onSelect?: (result: SearchResult) => void
  /**
   * Live navigation, role-filtered by the shell. Optional so the component
   * still renders (actions only) if a caller omits it.
   */
  pages?: SearchPage[]
}

const GROUP_LABEL: Record<SearchResultType, string> = {
  action: 'Quick actions',
  page: 'Pages',
  employee: 'People',
}

// Actions before pages before people: a query like "leave" more often means
// "I want to do something" than "show me a menu item", and a name rarely
// collides with either, so people sit last without being buried.
const RESULT_ORDER: SearchResultType[] = ['action', 'page', 'employee']

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** "EMP-0042 · Engineering · Senior Engineer", dropping whatever is unset. */
function hitSubtitle(e: EmployeeSearchHit): string {
  return [e.employeeCode, e.departmentName, e.jobTitle].filter(Boolean).join(' · ')
}

export function GlobalSearch({ onSelect, pages = [] }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const debouncedQuery = useDebounce(query, 150)
  const listRef = useRef<HTMLDivElement>(null)

  /* Permission filtering reuses the SDK's grant map — the same map
     `usePermission` reads, including its '*' wildcard for the platform
     superuser. A second authorisation system here would be one more thing to
     keep in sync with the backend, and one more way to leak an action the
     destination would 403 on. */
  const permissions = useAuthStore((s) => s.permissions)
  const allowed = useMemo(() => {
    const has = (code: string) => permissions.has(code) || permissions.has('*')
    return QUICK_ACTIONS.filter((a) => {
      if (a.anyOf) return a.anyOf.some(has)
      if (a.permission) return has(a.permission)
      return true   // open to any authenticated user
    })
  }, [permissions])

  /* People. This permission check is NOT the control — the endpoint enforces
     the same `hrms.employee.read` and RLS — it only stops the palette firing a
     request that would 403 on every keystroke for users who can't read the
     directory anyway. Requests go out only for ≥ 2 characters, debounced, and
     are de-duplicated by react-query's cache. */
  const canSearchPeople = permissions.has(EMPLOYEE_SEARCH_PERMISSION) || permissions.has('*')
  const peopleQuery = normalizeEmployeeQuery(debouncedQuery)
  const peopleActive = canSearchPeople && peopleQuery.length >= EMPLOYEE_SEARCH_MIN_CHARS
  const people = useEmployeeSearch(debouncedQuery, canSearchPeople)
  const peopleHits = useMemo<EmployeeSearchHit[]>(
    () => (peopleActive ? people.data?.employees ?? [] : []),
    [peopleActive, people.data],
  )
  const peopleError = peopleActive && people.isError
  const peopleLoading = peopleActive && people.isFetching
  const peopleTruncated = peopleActive && !people.isError && people.data?.truncated === true

  const results = useMemo<SearchResult[]>(() => {
    const q = debouncedQuery.trim()
    if (!q) return []
    const actions = rank(allowed, q, 6).map<SearchResult>((a) => ({
      id: a.id, type: 'action', label: a.label, description: a.description,
      path: a.path, category: a.category, keywords: a.keywords,
    }))
    const pageHits = rank(pages, q, 8).map<SearchResult>((pg) => ({
      id: pg.id, type: 'page', label: pg.label, description: pg.group,
      path: pg.path, keywords: pg.keywords,
    }))
    // The server already ranked (exact → prefix → substring) and bounded the
    // people hits; they are not re-scored or re-filtered here.
    const employees = peopleHits.map<SearchResult>((e) => ({
      id: `emp:${e.id}`, type: 'employee', label: e.displayName,
      description: hitSubtitle(e), path: `/hrms/employees/${e.id}`,
      avatarUrl: e.profilePhotoUrl,
    }))
    return [...actions, ...pageHits, ...employees]
  }, [debouncedQuery, allowed, pages, peopleHits])

  // Reset the highlight whenever the result set changes, so Enter can never
  // fire a stale row from the previous query.
  useEffect(() => { setCursor(0) }, [debouncedQuery])

  const grouped = useMemo(() => {
    const map = new Map<SearchResultType, SearchResult[]>()
    results.forEach((r) => {
      if (!map.has(r.type)) map.set(r.type, [])
      map.get(r.type)!.push(r)
    })
    return map
  }, [results])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[cursor]
      if (hit) onSelect?.(hit)
    }
    // Escape deliberately not handled here: PlatformShell already closes the
    // modal on Escape for the whole overlay, and swallowing it here would make
    // the two disagree depending on where focus happens to be.
  }

  // Keep the highlighted row inside the scroll viewport during keyboard nav.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  let flatIndex = -1

  return (
    <div className="flex flex-col">
      {/* The search row IS the focus affordance: the modal autofocuses this
          input, so the global :focus-visible outline only drew a stray green
          box around a bare input (the "off" look). The row communicates the
          active state instead — icon, generous height, kbd hint. */}
      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-bg)] text-[var(--accent-fg)]">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="global-search-results"
          aria-label={canSearchPeople ? 'Search people, pages and actions' : 'Search pages and actions'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canSearchPeople ? 'Search people, pages and actions…' : 'Search pages and actions…'}
          className="flex-1 bg-transparent text-[15px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus-visible:outline-none"
        />
        {query ? (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="rounded-md p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <kbd className="rounded-md border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--text-tertiary)]">ESC</kbd>
        )}
      </div>

      <div ref={listRef} id="global-search-results" role="listbox" className="max-h-96 overflow-y-auto">
        {!debouncedQuery && (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">Start typing to jump anywhere</p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              {canSearchPeople
                ? 'Try “leave”, “attendance”, “payroll” or a colleague’s name'
                : 'Try “leave”, “attendance”, “payroll” or “add employee”'}
            </p>
          </div>
        )}

        {/* "No results" must never stand in for a failed or still-running
            people request — an API error is not "no such employee". While the
            people request is pending or has failed, the People group below
            carries that state instead. */}
        {debouncedQuery && results.length === 0 && !peopleError && !peopleLoading && (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              {canSearchPeople
                ? <>No pages, actions or people match “{debouncedQuery}”</>
                : <>No pages or actions match “{debouncedQuery}”</>}
            </p>
            {canSearchPeople ? (
              peopleQuery.length < EMPLOYEE_SEARCH_MIN_CHARS && (
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Type at least {EMPLOYEE_SEARCH_MIN_CHARS} characters to search people.
                </p>
              )
            ) : (
              /* Honest about the boundary: people WILL type a colleague's name
                 here, and "no results" alone would read as "we have no such
                 employee" rather than "you can't search people". */
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Searching for a person? People search needs Workforce directory access.
              </p>
            )}
          </div>
        )}

        {RESULT_ORDER.map((type) => {
          const items = grouped.get(type) ?? []
          const isPeople = type === 'employee'
          // The People group also renders with zero rows when it has something
          // to say (still searching, failed, too many matches): that state
          // belongs to the group, so a failure never masquerades as "no one
          // matched" and never touches the actions/pages above it.
          const peopleStatus = isPeople && (peopleLoading || peopleError || peopleTruncated)
          if (!items.length && !peopleStatus) return null
          return (
            <div key={type} data-result-group={type}>
              <div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                <span>{GROUP_LABEL[type]}</span>
                {isPeople && peopleLoading && (
                  <span className="normal-case tracking-normal" aria-live="polite">Searching…</span>
                )}
              </div>
              {isPeople && peopleError && (
                <div
                  role="alert"
                  data-testid="employee-search-error"
                  className="mx-4 mb-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                >
                  People search is unavailable right now. Pages and actions still work — try again in a moment.
                </div>
              )}
              {items.map((result) => {
                flatIndex += 1
                const active = flatIndex === cursor
                const myIndex = flatIndex
                return (
                  <button
                    key={result.id}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    data-result-type={type}
                    onMouseEnter={() => setCursor(myIndex)}
                    onClick={() => onSelect?.(result)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      active ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    {type === 'employee' && result.avatarUrl ? (
                      <img
                        src={result.avatarUrl}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center text-[11px] font-bold ${
                          type === 'action'
                            ? 'rounded-lg bg-[var(--accent-solid)] text-white'
                            : type === 'employee'
                              ? 'rounded-full bg-[var(--accent-bg)] text-[var(--accent-fg)]'
                              : 'rounded-lg bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {type === 'action' ? '↳' : type === 'employee' ? initials(result.label) : '#'}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--text-primary)]">{result.label}</span>
                      {result.description && (
                        <span className="block truncate text-xs text-[var(--text-tertiary)]">{result.description}</span>
                      )}
                    </span>
                    {active && (
                      <kbd className="hidden rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-tertiary)] sm:inline-block">
                        ↵
                      </kbd>
                    )}
                  </button>
                )
              })}
              {isPeople && peopleTruncated && (
                <p
                  data-testid="employee-search-truncated"
                  className="px-4 pb-2 pt-1 text-xs text-[var(--text-tertiary)]"
                >
                  Showing the first {people.data?.limit ?? items.length} people — keep typing to narrow it down.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
