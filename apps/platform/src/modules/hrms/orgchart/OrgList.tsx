// The org chart on a phone: the same tree as an indented list, top person
// first, each person's reports under them (opened with the chevron).
import { memo, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/design/kit/display'
import { COMPANY_ROOT, listRows, plural, statusLabel, type OrgTree } from './orgTree'
import type { CardHandlers } from './OrgCards'

const MAX_INDENT = 8

interface OrgListProps extends CardHandlers {
  tree: OrgTree
  expanded: ReadonlySet<string>
  found: string | null
  companyName: string
  /** Bumped by the page to bring `found` into view. */
  revealSeq: number
}

export const OrgList = memo(function OrgList({ tree, expanded, found, companyName, revealSeq, onOpen, onToggle }: OrgListProps) {
  const ref = useRef<HTMLUListElement>(null)
  const rows = listRows(tree, expanded)

  useEffect(() => {
    if (!found || !revealSeq) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(found)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.querySelector<HTMLElement>('.uoc-row__main')?.focus({ preventScroll: true })
  }, [found, revealSeq])

  return (
    <ul ref={ref} className="uoc-list" aria-label="Org chart">
      {rows.map((r) => {
        const n = tree.nodes.get(r.id)!
        const p = n.person
        const you = r.id === tree.you
        const name = p ? p.name : companyName
        const sub = p ? [p.designation, p.department].filter(Boolean).join(' · ') : plural(tree.size, 'person', 'people')
        const status = p ? statusLabel(p.status) : null
        return (
          <li key={r.id} data-row={r.id} data-depth={r.depth} className={`uoc-row${you ? ' is-you' : ''}${r.id === found ? ' is-found' : ''}`}>
            {/* Indent by level, up to eight levels so deep lines keep room for the name on a phone. */}
            {Array.from({ length: Math.min(r.depth, MAX_INDENT) }, (_, i) => <span key={i} className="uoc-row__guide" aria-hidden="true" />)}
            {r.hasChildren
              ? (
                <button type="button" className="uoc-row__toggle" aria-expanded={r.open}
                  aria-label={`${r.open ? 'Hide' : 'Show'} ${plural(n.children.length, 'person', 'people')} ${r.id === COMPANY_ROOT ? 'at the top level' : `who report to ${name}`}`}
                  onClick={(e) => onToggle(r.id, e.currentTarget)}>
                  <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )
              : <span className="uoc-row__spacer" aria-hidden="true" />}
            <button type="button" className="uoc-row__main" data-card={r.id}
              onClick={(e) => (r.id === COMPANY_ROOT ? onToggle(r.id, e.currentTarget) : onOpen(r.id, e.currentTarget))}>
              <Avatar name={name} src={p?.photoUrl} size={36} tone={you || !p ? 'solid' : 'soft'} shape={p ? 'circle' : 'square'} />
              <span className="uoc-row__txt">
                <span className="uoc-row__name">
                  <span>{name}</span>
                  {you && <span className="uoc-you">You</span>}
                </span>
                {(sub || status) && <span className="uoc-row__sub">{[status?.label, sub].filter(Boolean).join(' · ')}</span>}
              </span>
              {n.children.length > 0 && (
                <span className="uoc-row__n">
                  <span aria-hidden="true">{n.children.length}</span>
                  <span className="sr-only">, {plural(n.children.length, 'report', 'reports')}</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
})
