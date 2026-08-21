import React, { useState, useMemo } from 'react'
import { useDebounce } from '../hooks/useDebounce'

interface SearchResult {
  id: string
  type: 'page' | 'module' | 'employee' | 'lead' | 'invoice'
  title: string
  subtitle?: string
  path: string
  score: number
  icon?: string
}

// Global search over invented data ("Alice Martin", "Acme Corp Lead $45,000",
// "INV-2025-001") was reported live in a real customer's Cmd-K panel on
// 2026-08-10. The MOCK_DATA constant and its scoring helper have been removed
// entirely so the palette cannot ever paint fake employees, leads or invoices
// again. Data must come from a backend endpoint. Do not repopulate this
// constant — wire a real /v1/search endpoint instead.

const TYPE_ICONS: Record<SearchResult['type'], string> = {
  page: '📄',
  module: '🧩',
  employee: '👤',
  lead: '📊',
  invoice: '🧾',
}

const TYPE_LABELS: Record<SearchResult['type'], string> = {
  page: 'Pages',
  module: 'Modules',
  employee: 'Employees',
  lead: 'Leads',
  invoice: 'Invoices',
}

interface GlobalSearchProps {
  onSelect?: (result: SearchResult) => void
}

export function GlobalSearch({ onSelect }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 200)

  const results = useMemo<SearchResult[]>(() => {
    // Suppressed until a real search backend lands. Returning [] keeps the
    // palette usable for the OTHER wired features (recent, favourites) if
    // those are added, without showing anyone fake people or fake invoices.
    void debouncedQuery
    return []
  }, [debouncedQuery])

  const grouped = useMemo(() => {
    const map = new Map<SearchResult['type'], SearchResult[]>()
    results.forEach((r) => {
      if (!map.has(r.type)) map.set(r.type, [])
      map.get(r.type)!.push(r)
    })
    return map
  }, [results])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
        <svg className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages, employees, leads, invoices..."
          className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none text-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {!debouncedQuery && (
          <div className="p-6 text-center text-[var(--text-tertiary)] text-sm">
            Start typing to search your workspace
          </div>
        )}
        {debouncedQuery && results.length === 0 && (
          <div className="p-6 text-center text-[var(--text-tertiary)] text-sm">
            Global search is coming soon.
            <br />
            <span className="text-xs">
              Meanwhile, use the sidebar or the module pages to find people, leaves and payslips.
            </span>
          </div>
        )}
        {Array.from(grouped.entries()).map(([type, items]) => (
          <div key={type}>
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
              {TYPE_LABELS[type]}
            </div>
            {items.map((result) => (
              <button
                key={result.id}
                onClick={() => onSelect?.(result)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-subtle)] transition-colors text-left"
              >
                <span className="text-base">{TYPE_ICONS[result.type]}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] truncate">{result.title}</div>
                  {result.subtitle && (
                    <div className="text-xs text-[var(--text-tertiary)] truncate">{result.subtitle}</div>
                  )}
                </div>
                <svg className="w-3 h-3 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
