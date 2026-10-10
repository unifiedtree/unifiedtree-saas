// Coverage rows under the grid (design §1.6): per shift per day "4/4" (met), "1/2" (short), "5/4" (more than
// needed), blank (no requirement) and "–" (holiday, not checked); each shift opens to its designations. They sit in
// the grid's own table so every day lines up with its column.
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CoverageLine } from '../plannerModel'

export function CoverageRows({ groups, dayCount, trailing, expanded, onToggle }: {
  groups: { line: CoverageLine; parts: CoverageLine[] }[]
  dayCount: number
  /** Columns after the days (the totals), left empty here. */
  trailing: number
  expanded: ReadonlySet<string>
  onToggle: (shiftPolicyId: string) => void
}) {
  if (!groups.length) return null
  const row = (l: CoverageLine, sub: boolean, open?: boolean, canOpen?: boolean) => (
    <tr key={l.key} className={sub ? 'spl-cov__row spl-cov__row--sub' : 'spl-cov__row'}>
      <th scope="row" className="spl-grid__name spl-cov__label">
        {sub ? <span className="spl-cov__sub">{l.label}</span> : (
          <button type="button" className="spl-cov__toggle" aria-expanded={canOpen ? !!open : undefined} disabled={!canOpen}
            onClick={() => onToggle(l.shiftPolicyId)} title={canOpen ? (open ? 'Hide designations' : 'Show by designation') : undefined}>
            {canOpen ? (open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />) : <span className="spl-cov__dot" aria-hidden="true" />}
            <span>{l.label}</span>
            {l.short > 0 && <span className="spl-cov__short">{l.short} short</span>}
          </button>
        )}
      </th>
      {l.cells.slice(0, dayCount).map((c, i) => (
        <td key={i} className="spl-cov__cell" data-tone={c.tone} title={c.title}>{c.label}</td>
      ))}
      {Array.from({ length: Math.max(0, dayCount - l.cells.length) }, (_, i) => <td key={`pad${i}`} className="spl-cov__cell" />)}
      {trailing > 0 && <td className="spl-cov__cell spl-cov__cell--trail" colSpan={trailing} />}
    </tr>
  )
  return (
    <tbody className="spl-cov" aria-label="Coverage">
      <tr className="spl-cov__head">
        <th scope="rowgroup" className="spl-grid__name spl-cov__title">Coverage</th>
        <td colSpan={dayCount + trailing} />
      </tr>
      {groups.flatMap((g) => {
        const open = expanded.has(g.line.shiftPolicyId)
        return [row(g.line, false, open, g.parts.length > 0), ...(open ? g.parts.map((p) => row(p, true)) : [])]
      })}
    </tbody>
  )
}
