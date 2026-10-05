// Home's people cards and the Celebrations page's sections: Celebrations (birthdays, work
// anniversaries, Welcome aboard), Off this week and Upcoming holidays. The mobile app's Home and
// /milestones show the same cards from the same reads and the same rules (peopleModel.ts).
// They only lay out what they are given; every value is real API data.
import { Avatar, DateTile, ListRow, ListRows, Section } from '@/design/kit/display'
import {
  celebrationSub, chipOf, dateTileOf, homeRow, initialsOfName, isPast,
  type Celebration, type CelebrationSection, type HolidayLike, type OffPerson,
} from './peopleModel'
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

/** How many faces the Home row shows before "+N". */
export const HOME_FACES = 6

export function CelebrationsCard({ items, loading, error, onRetry, today, onSeeAll }: {
  items: readonly Celebration[]; loading: boolean; error: unknown; onRetry: () => void; today: string; onSeeAll: () => void
}) {
  const row = homeRow(items, today)
  const shown = row.slice(0, HOME_FACES)
  const more = row.length - shown.length
  return (
    <Section variant="panel" title="Celebrations" body="default" loading={loading} error={error} onRetry={onRetry} skeleton="text"
      sub={row.length ? 'Birthdays, work anniversaries and new joiners' : undefined}
      action={{ label: 'See all', onClick: onSeeAll, ariaLabel: 'See all celebrations' }}
      empty={!row.length ? { title: 'Nothing to celebrate this week', hint: 'Birthdays, work anniversaries and new joiners show here.', icon: 'calendar' } : undefined}>
      <ul className="uh-faces" aria-label="Celebrations this week">
        {shown.map((c) => (
          <li key={`${c.kind}-${c.employeeId ?? c.name}-${c.date}`}>
            <button type="button" className="uh-faces__btn" onClick={onSeeAll}
              aria-label={`${c.name}: ${chipOf(c) === 'New' ? 'new joiner' : chipOf(c).toLowerCase()}, ${celebrationSub(c, today)}`}>
              <PersonFace c={c} />
              <span className="uh-faces__name">{c.name.split(/\s+/)[0]}</span>
              <span className={`uh-faces__when${c.date === today ? ' uh-faces__when--today' : ''}`}>{celebrationWhen(c, today)}</span>
            </button>
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
      </ul>
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

export function CelebrationSectionCard({ section, today, index }: { section: CelebrationSection; today: string; index: number }) {
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
              className={past ? 'uh-past' : undefined}
              leading={<PersonFace c={c} size={40} />}
              title={c.name} sub={celebrationSub(c, today)}
              end={c.date === today
                ? <span className="uh-today">Today</span>
                : <DateTile day={tile.day} month={tile.month} label={tile.label} />} />
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
