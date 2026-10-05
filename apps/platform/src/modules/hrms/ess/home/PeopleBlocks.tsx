// Home's people cards and the Celebrations page's sections: Celebrations (birthdays, work
// anniversaries, Welcome aboard), Off this week and Upcoming holidays. The mobile app's Home and
// /milestones show the same cards from the same reads and the same rules (peopleModel.ts).
// They only lay out what they are given; every value is real API data. "Send wishes" (V143_84)
// shows only where the server offers it (WishBlocks.tsx).
import { useEffect, useState } from 'react'
import { PartyPopper } from 'lucide-react'
import { Avatar, DateTile, ListRow, ListRows, Section } from '@/design/kit/display'
import {
  celebrationSub, chipOf, dateTileOf, homeRow, initialsOfName, isPast,
  type Celebration, type CelebrationSection, type HolidayLike, type OffPerson,
} from './peopleModel'
import { WishButton, type WishControls } from './WishBlocks'
import './home.css'

const CHIP_CLASS: Record<string, string> = { BIRTHDAY: 'uh-chip--bday', WORK_ANNIVERSARY: 'uh-chip--anniv', NEW_JOINER: 'uh-chip--new' }

/** An avatar with its small chip ("Birthday", "3 yrs", "New") hanging off the bottom edge. */
function PersonFace({ c, size = 52 }: { c: Celebration; size?: number }) {
  return (
    <span className="uh-face" style={{ width: size }}>
      <Avatar name={c.name} initials={initialsOfName(c.name)} size={size} tone="pale" ring="surface" />
      <span className={`uh-chip ${CHIP_CLASS[c.kind] ?? ''}`}>{chipOf(c)}</span>
    </span>
  )
}

// ── Celebrations (Home) ─────────────────────────────────────────────────────

/** Most faces the Home row shows before "+N"; fewer when the card is narrow (one row, never wrapped). */
export const HOME_FACES = 6
/** One face's column, gap included (.uh-faces). */
const FACE_COL = 72

/** How many columns of faces fit across the list (7 until it has been measured). The list mounts after loading, hence a callback ref. */
function useFaceColumns() {
  const [el, setEl] = useState<HTMLUListElement | null>(null)
  const [cols, setCols] = useState(HOME_FACES + 1)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setCols(Math.max(2, Math.floor((e.contentRect.width + 8) / FACE_COL))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return { ref: setEl, cols }
}

export function CelebrationsCard({ items, loading, error, onRetry, today, onSeeAll, wishes = null, birthdaysHidden = false }: {
  items: readonly Celebration[]; loading: boolean; error: unknown; onRetry: () => void; today: string; onSeeAll: () => void
  /** Send wishes and "12 people wished you"; null while the server has none. */
  wishes?: WishControls | null
  /** The company hides birthdays from colleagues: the words leave them out. */
  birthdaysHidden?: boolean
}) {
  const row = homeRow(items, today)
  const { ref, cols } = useFaceColumns()
  const fit = Math.min(HOME_FACES, row.length > cols ? cols - 1 : cols)
  const shown = row.slice(0, fit)
  const more = row.length - shown.length
  const wishedMe = wishes?.receivedLine ?? ''
  const what = birthdaysHidden ? 'Work anniversaries and new joiners' : 'Birthdays, work anniversaries and new joiners'
  return (
    <Section variant="panel" title="Celebrations" body="default" loading={loading} error={error} onRetry={onRetry} skeleton="text"
      sub={row.length ? what : undefined}
      action={{ label: 'See all', onClick: onSeeAll, ariaLabel: 'See all celebrations' }}
      empty={!row.length && !wishedMe ? { title: 'Nothing to celebrate this week', hint: `${what} show here.`, icon: 'calendar' } : undefined}>
      {wishedMe && (
        <button type="button" className="uh-wishedme" onClick={onSeeAll} aria-label={`${wishedMe}: see your wishes`}>
          <PartyPopper size={15} aria-hidden="true" /><span>{wishedMe}</span><span className="uh-wishedme__see">See</span>
        </button>
      )}
      {row.length > 0 && <ul ref={ref} className="uh-faces" aria-label="Celebrations this week">
        {shown.map((c) => (
          <li key={`${c.kind}-${c.employeeId ?? c.name}-${c.date}`} className="uh-faces__item">
            <button type="button" className="uh-faces__btn" onClick={onSeeAll}
              aria-label={`${c.name}: ${chipOf(c) === 'New' ? 'new joiner' : chipOf(c).toLowerCase()}, ${celebrationSub(c, today)}`}>
              <PersonFace c={c} />
              <span className="uh-faces__name">{c.name.split(/\s+/)[0]}</span>
              <span className={`uh-faces__when${c.date === today ? ' uh-faces__when--today' : ''}`}>{celebrationWhen(c, today)}</span>
            </button>
            <WishButton c={c} wishes={wishes} compact />
          </li>
        ))}
        {more > 0 && (
          <li>
            <button type="button" className="uh-faces__btn" onClick={onSeeAll} aria-label={`${more} more: see all celebrations`}>
              <span className="uh-faces__more" aria-hidden="true">+{more}</span>
              <span className="uh-faces__name">See all</span>
            </button>
          </li>
        )}
      </ul>}
    </Section>
  )
}

/** Under a face: "Today", "Fri", "9 Oct", "Joined Mon". */
function celebrationWhen(c: Celebration, today: string): string {
  if (c.date === today) return 'Today'
  const sub = celebrationSub({ ...c, departmentName: null }, today)
  return sub.replace(/^Joined /, '').replace(/^on /, '')
}

// ── Celebrations page: one section ──────────────────────────────────────────

export function CelebrationSectionCard({ section, today, index, wishes = null }: {
  section: CelebrationSection; today: string; index: number
  /** Send wishes on today's people (and Welcome aboard); null while the server has none. */
  wishes?: WishControls | null
}) {
  return (
    <Section variant="panel" title={section.title} sub={section.line} count={section.items.length || null} countTone="neutral"
      countLabel={`${section.items.length} ${section.title.toLowerCase()}`} body="list" index={index}
      empty={!section.items.length ? { title: section.empty.title, hint: section.empty.hint, icon: 'calendar' } : undefined}>
      <ListRows label={section.title}>
        {section.items.map((c) => {
          const past = isPast(c, today)
          const tile = dateTileOf(c.date)
          return (
            <ListRow key={`${c.kind}-${c.employeeId ?? c.name}-${c.date}`} variant="divided" density="default"
              className={[past ? 'uh-past' : '', wishes?.canWish(c) ? 'uh-row--wish' : ''].filter(Boolean).join(' ') || undefined}
              leading={<PersonFace c={c} size={40} />}
              title={c.name} sub={celebrationSub(c, today)}
              end={c.date === today
                ? <span className="uh-today">Today</span>
                : <DateTile day={tile.day} month={tile.month} label={tile.label} />}
              actions={wishes?.canWish(c) ? <WishButton c={c} wishes={wishes} /> : undefined} />
          )
        })}
      </ListRows>
    </Section>
  )
}

// ── Off this week ───────────────────────────────────────────────────────────

export function OffThisWeekCard({ people, scope, loading, error, onRetry }: {
  people: readonly OffPerson[]; scope: 'team' | 'department'; loading: boolean; error: unknown; onRetry: () => void
}) {
  return (
    <Section variant="panel" title="Off this week" body="list" loading={loading} error={error} onRetry={onRetry}
      sub={scope === 'team' ? 'Approved leave in your team' : 'Approved leave in your department'}
      count={people.length || null} countTone="neutral" countLabel={`${people.length} off this week`}
      empty={!people.length ? { title: 'Everyone’s in this week', hint: 'Nobody has approved leave from Monday to Sunday.', icon: 'checkCircle' } : undefined}>
      <ListRows label="Off this week">
        {people.map((p) => (
          <ListRow key={p.key} variant="divided" density="default"
            leading={<Avatar name={p.name} initials={initialsOfName(p.name)} size={34} tone="pale" />}
            title={p.name} sub={p.leaveType ?? undefined}
            end={<span className={p.offToday ? 'uh-today' : 'uh-off-when'}>{p.offToday && p.when !== 'Today' ? `Today · ${p.when}` : p.when}</span>} />
        ))}
      </ListRows>
    </Section>
  )
}

// ── Upcoming holidays ───────────────────────────────────────────────────────

export function UpcomingHolidaysCard({ holidays, loading, error, onRetry, today, onOpen }: {
  holidays: readonly HolidayLike[]; loading: boolean; error: unknown; onRetry: () => void; today: string; onOpen?: () => void
}) {
  return (
    <Section variant="panel" title="Upcoming holidays" body="list" loading={loading} error={error} onRetry={onRetry}
      action={onOpen ? { label: 'All holidays', onClick: onOpen, ariaLabel: 'See all holidays' } : undefined}
      empty={!holidays.length ? { title: 'No more holidays this year', hint: 'Your company’s holiday list shows here.', icon: 'calendar' } : undefined}>
      <ListRows label="Upcoming holidays">
        {holidays.map((h) => {
          const t = dateTileOf(h.date)
          return (
            <ListRow key={`${h.date}-${h.name}`} variant="divided" density="default"
              leading={<DateTile day={t.day} month={t.month} label={t.label} />}
              title={h.name} sub={h.date.slice(0, 10) === today ? 'Today' : t.label} />
          )
        })}
      </ListRows>
    </Section>
  )
}
