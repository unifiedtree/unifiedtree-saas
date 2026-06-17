import React, { useMemo, useState } from 'react'
import { Search, Check } from 'lucide-react'
import { clsx } from 'clsx'
import type { WorkforceEmployee } from '../../api/useWorkforce'

/** Searchable employee multi-select with checkboxes (used by the wizard CUSTOM_LIST step). */
export function RecipientPicker({
  employees,
  selected,
  onChange,
}: {
  employees: WorkforceEmployee[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return employees
    return employees.filter((e) =>
      [e.firstName, e.lastName, e.employeeCode, e.email].filter(Boolean).join(' ').toLowerCase().includes(needle),
    )
  }, [employees, q])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-slate-50">
        <Search size={14} className="text-text-secondary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employees…"
          className="flex-1 bg-transparent text-sm text-text-primary focus:outline-none"
        />
        <span className="text-xs text-text-secondary">{selected.size} selected</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-text-secondary">No employees match</p>
        ) : (
          filtered.map((e) => (
            <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-border/40">
              <span className={clsx('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                selected.has(e.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300')}>
                {selected.has(e.id) && <Check size={11} className="text-white" />}
              </span>
              <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="sr-only" />
              <span className="flex-1 text-sm text-text-primary">
                {[e.firstName, e.lastName].filter(Boolean).join(' ')}{e.employeeCode ? ` (${e.employeeCode})` : ''}
              </span>
              {!e.email && <span className="text-xs text-amber-600 flex-shrink-0">no email</span>}
            </label>
          ))
        )}
      </div>
    </div>
  )
}
