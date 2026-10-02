// The org chart's cards (Keka: photo, name, designation, branch, DEPARTMENT, and
// a count pill under the card that opens and closes the person's reports),
// and the company card drawn above several top-level people.
import { memo, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Avatar, StatusPill } from '@/design/kit/display'
import type { OrgPerson } from './useOrgChart'
import { plural, statusLabel } from './orgTree'

export interface CardHandlers {
  /** The card itself: opens the profile, or the person's card. */
  onOpen: (id: string, el: HTMLElement) => void
  /** The count pill: shows or hides the reports. */
  onToggle: (id: string, el: HTMLElement) => void
}

interface PersonCardProps extends CardHandlers {
  person: OrgPerson
  /** Reports on the chart (the pill's number). */
  reports: number
  open: boolean
  you: boolean
  found: boolean
  style: CSSProperties
}

/** Who reports to whom, said once for screen readers. */
export function personSummary(p: OrgPerson, you: boolean): string {
  return [p.name + (you ? ' (you)' : ''), p.designation, p.department, p.location].filter(Boolean).join(', ')
}

export const PersonCard = memo(function PersonCard({ person: p, reports, open, you, found, style, onOpen, onToggle }: PersonCardProps) {
  const status = statusLabel(p.status)
  return (
    <div className={`uoc-node${you ? ' is-you' : ''}${found ? ' is-found' : ''}`} style={style} data-person={p.id}>
      <button type="button" className="uoc-card" data-card={p.id} aria-label={personSummary(p, you)}
        onClick={(e) => onOpen(p.id, e.currentTarget)}>
        <Avatar name={p.name} src={p.photoUrl} size={44} tone={you ? 'solid' : 'soft'} />
        <span className="uoc-card__txt">
          <span className="uoc-card__top">
            <span className="uoc-card__name">{p.name}</span>
            {you && <span className="uoc-you">You</span>}
          </span>
          {p.designation && <span className="uoc-card__role">{p.designation}</span>}
          {p.location && <span className="uoc-card__meta">{p.location}</span>}
          {p.department && <span className="uoc-card__dept">{p.department}</span>}
        </span>
        {status && <StatusPill tone={status.tone} size="xs" className="uoc-status">{status.label}</StatusPill>}
      </button>
      {reports > 0 && (
        <button type="button" className="uoc-pill" aria-expanded={open} data-toggle={p.id}
          aria-label={`${open ? 'Hide' : 'Show'} ${plural(reports, 'person', 'people')} who report to ${p.name}`}
          onClick={(e) => onToggle(p.id, e.currentTarget)}>
          {String(reports).padStart(2, '0')}
          {open ? <ChevronUp size={13} strokeWidth={2.4} aria-hidden="true" /> : <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      )}
    </div>
  )
})

interface CompanyCardProps {
  name: string
  people: number
  tops: number
  open: boolean
  style: CSSProperties
  onToggle: (id: string, el: HTMLElement) => void
  id: string
}

/** The company at the top when several people have no manager on the chart. */
export const CompanyCard = memo(function CompanyCard({ name, people, tops, open, style, onToggle, id }: CompanyCardProps) {
  return (
    <div className="uoc-node" style={style} data-person={id}>
      <button type="button" className="uoc-card uoc-card--company" data-card={id} aria-expanded={open}
        aria-label={`${name}, ${plural(people, 'person', 'people')}. ${open ? 'Hide' : 'Show'} the ${plural(tops, 'person', 'people')} at the top level`}
        onClick={(e) => onToggle(id, e.currentTarget)}>
        <Avatar name={name} size={44} tone="solid" shape="square" />
        <span className="uoc-card__txt">
          <span className="uoc-card__name">{name}</span>
          <span className="uoc-card__role">{plural(people, 'person', 'people')}</span>
        </span>
      </button>
      {/* The same switch as the card (which carries it for keyboards and screen readers), drawn as Keka's pill. */}
      <span className="uoc-pill" aria-hidden="true" data-expanded={open} onClick={(e) => onToggle(id, e.currentTarget)}>
        {String(tops).padStart(2, '0')}
        {open ? <ChevronUp size={13} strokeWidth={2.4} /> : <ChevronDown size={13} strokeWidth={2.4} />}
      </span>
    </div>
  )
})
