// Pick people for a distribution: a searchable list with ticks (the wizard's
// "Pick people" recipients). Searches the directory page the wizard loaded.
import { useMemo, useState } from 'react'
import { Checkbox, Input } from '@/design/kit/overlays'
import type { WorkforceEmployee } from '../../api/useWorkforce'
import './letters.css'

export function RecipientPicker({ employees, selected, onChange }: {
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
    <div className="lt-picker">
      <Input label="Search employees" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or email"
        hint={`${selected.size} selected`} />
      <div className="lt-picker__list" role="group" aria-label="Employees">
        {filtered.length === 0 ? <p className="lt-person__note">No employees match</p> : filtered.map((e) => (
          <div key={e.id} className="lt-picker__row">
            <Checkbox checked={selected.has(e.id)} onChange={() => toggle(e.id)}
              label={`${[e.firstName, e.lastName].filter(Boolean).join(' ')}${e.employeeCode ? ` (${e.employeeCode})` : ''}`}
              description={e.email ? undefined : 'No email: will be skipped'} />
          </div>
        ))}
      </div>
    </div>
  )
}
