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

const MOCK_DATA: Omit<SearchResult, 'score'>[] = [
  // Pages
  { id: 'p1', type: 'page', title: 'Dashboard', subtitle: 'Home', path: '/dashboard' },
  { id: 'p2', type: 'page', title: 'Employee List', subtitle: 'HRMS', path: '/hrms/employees' },
  { id: 'p3', type: 'page', title: 'Leave Management', subtitle: 'HRMS', path: '/hrms/leaves' },
  { id: 'p4', type: 'page', title: 'Payroll', subtitle: 'HRMS', path: '/hrms/payroll' },
  { id: 'p5', type: 'page', title: 'CRM Pipeline', subtitle: 'CRM', path: '/crm/pipeline' },
  { id: 'p6', type: 'page', title: 'Leads', subtitle: 'CRM', path: '/crm/leads' },
  { id: 'p7', type: 'page', title: 'Invoices', subtitle: 'Accounts', path: '/accounts/invoices' },
  { id: 'p8', type: 'page', title: 'Settings', subtitle: 'Configuration', path: '/settings' },
  // Employees
  { id: 'e1', type: 'employee', title: 'Alice Martin', subtitle: 'Engineering · Senior Dev', path: '/hrms/employees/e1' },
  { id: 'e2', type: 'employee', title: 'Bob Carter', subtitle: 'Marketing · Manager', path: '/hrms/employees/e2' },
  { id: 'e3', type: 'employee', title: 'Carol White', subtitle: 'Finance · Analyst', path: '/hrms/employees/e3' },
  { id: 'e4', type: 'employee', title: 'David Kim', subtitle: 'Design · Lead', path: '/hrms/employees/e4' },
  // Leads
  { id: 'l1', type: 'lead', title: 'Acme Corp', subtitle: 'Lead · $45,000', path: '/crm/leads/l1' },
  { id: 'l2', type: 'lead', title: 'GlobalTech Ltd', subtitle: 'Lead · $128,000', path: '/crm/leads/l2' },
  { id: 'l3', type: 'lead', title: 'Pinnacle Solutions', subtitle: 'Qualified · $67,500', path: '/crm/leads/l3' },
  // Invoices
  { id: 'inv1', type: 'invoice', title: 'INV-2025-001', subtitle: 'Acme Corp · $12,500', path: '/accounts/invoices/inv1' },
  { id: 'inv2', type: 'invoice', title: 'INV-2025-002', subtitle: 'GlobalTech · $8,000', path: '/accounts/invoices/inv2' },
]

function scoreResult(result: Omit<SearchResult, 'score'>, query: string): number {
  const q = query.toLowerCase()
  const title = result.title.toLowerCase()
  const subtitle = (result.subtitle ?? '').toLowerCase()
  if (title === q) return 100
  if (title.startsWith(q)) return 80
  if (title.includes(q)) return 60
  if (subtitle.includes(q)) return 30
  return 0
}

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
    if (!debouncedQuery.trim()) return []
    return MOCK_DATA
      .map((item) => ({ ...item, score: scoreResult(item, debouncedQuery) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages, employees, leads, invoices..."
          className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none text-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {!debouncedQuery && (
          <div className="p-6 text-center text-slate-500 text-sm">
            Start typing to search your workspace
          </div>
        )}
        {debouncedQuery && results.length === 0 && (
          <div className="p-6 text-center text-slate-500 text-sm">
            No results for "{debouncedQuery}"
          </div>
        )}
        {Array.from(grouped.entries()).map(([type, items]) => (
          <div key={type}>
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
              {TYPE_LABELS[type]}
            </div>
            {items.map((result) => (
              <button
                key={result.id}
                onClick={() => onSelect?.(result)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
              >
                <span className="text-base">{TYPE_ICONS[result.type]}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{result.title}</div>
                  {result.subtitle && (
                    <div className="text-xs text-slate-500 truncate">{result.subtitle}</div>
                  )}
                </div>
                <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
