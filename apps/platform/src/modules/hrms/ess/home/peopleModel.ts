// Celebrations, Off this week and Upcoming holidays: the pure rules behind the Home cards and the
// Celebrations page. THE SAME FILE is in the mobile app (components/home/peopleModel.ts), byte for
// byte, so the website and the app put the same people in the same order with the same words.
// No imports on purpose: dates are yyyy-MM-dd strings worked out in UTC, so the phone's or the
// browser's own time zone never moves a day. "Today" always comes from the caller (India's date).
//
// Data:
//   GET /v1/ess/celebrations?days=30     birthdays + work anniversaries (a week back to 30 days on)
//                                        and who joined in the last 30 days (Welcome aboard)
//   GET /v1/ess/around-me?days=30        the fallback while a server doesn't have the above (404):
//                                        birthdays and anniversaries only, from today on
//   GET /v1/team/time-off?from=&to=      Off this week for team approvers (leave, approved)
//   GET /v1/leave/team-off?from=&to=     Off this week for everyone else (same-department colleagues)

// ── dates ───────────────────────────────────────────────────────────────────

const SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHORT_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function utc(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)))
}
function ymdOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
export function plusDays(ymd: string, n: number): string {
  return ymdOf(utc(ymd) + n * 86_400_000)
}
export function dayDiff(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfYmd(ymd: string): number {
  return new Date(utc(ymd)).getUTCDay()
}
/** "5 Oct". */
export function dayMonthOf(ymd: string): string {
  return `${Number(ymd.slice(8, 10))} ${SHORT_MON[Number(ymd.slice(5, 7)) - 1] ?? ''}`
}
/** The date tile: "05" over "OCT", and "5 October"-style words for screen readers. */
export function dateTileOf(ymd: string): { day: string; month: string; label: string } {
  return { day: ymd.slice(8, 10), month: (SHORT_MON[Number(ymd.slice(5, 7)) - 1] ?? '').toUpperCase(), label: `${LONG_WD[weekdayOfYmd(ymd)]} ${dayMonthOf(ymd)}` }
}
/** "Today", "Tomorrow", "Yesterday", "Friday" (this week), "3 days ago", "9 Oct". */
export function whenWords(ymd: string, today: string): string {
  const n = dayDiff(today, ymd)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n > 1 && n <= 6) return LONG_WD[weekdayOfYmd(ymd)]
  if (n < -1 && n >= -7) return `${-n} days ago`
  return dayMonthOf(ymd)
}

// ── celebrations ────────────────────────────────────────────────────────────

export type CelebrationKind = 'BIRTHDAY' | 'WORK_ANNIVERSARY' | 'NEW_JOINER'

export interface Celebration {
  kind: CelebrationKind | (string & {})
  /** The day it falls on this time; for a new joiner, the joining date. */
  date: string
  employeeId: string | null
  name: string
  departmentName: string | null
  /** Work anniversaries only: which one. Never an age. */
  years: number | null
}

export interface CelebrationsData {
  today: string | null
  items: Celebration[]
  /** False while the server can't say who joined (an older server, or that part failed). */
  joinersKnown: boolean
}

/** One around-me row, the fields the fallback reads. */
export interface AroundLike {
  kind: string
  date: string
  title: string
  employeeId: string | null
  departmentName: string | null
  years: number | null
}

/** "Kavya Menon’s birthday" → "Kavya Menon" (the server's own wording on around-me). */
export function nameFromTitle(title: string): string {
  return title.replace(/[’']s (birthday|work anniversary)$/i, '').trim() || title
}

/** /v1/ess/celebrations as it comes from the server. */
export function fromCelebrations(raw: { today?: string | null; items?: unknown; included?: unknown; unavailable?: unknown } | null | undefined): CelebrationsData {
  const list = Array.isArray(raw?.items) ? (raw!.items as Record<string, unknown>[]) : []
  const included = Array.isArray(raw?.included) ? (raw!.included as string[]) : []
  return {
    today: typeof raw?.today === 'string' ? raw.today.slice(0, 10) : null,
    items: list
      .map((r) => ({
        kind: String(r.kind ?? ''),
        date: typeof r.date === 'string' ? r.date.slice(0, 10) : '',
        employeeId: typeof r.employeeId === 'string' ? r.employeeId : null,
        name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Colleague',
        departmentName: typeof r.departmentName === 'string' ? r.departmentName : null,
        years: typeof r.years === 'number' ? r.years : null,
      }))
      .filter((c) => !!c.date),
    joinersKnown: included.includes('NEW_JOINER'),
  }
}

/** The around-me fallback: its birthdays and work anniversaries, nobody new (it can't say). */
export function fromAroundMe(items: readonly AroundLike[]): CelebrationsData {
  return {
    today: null,
    items: items
      .filter((i) => i.kind === 'BIRTHDAY' || i.kind === 'WORK_ANNIVERSARY')
      .map((i) => ({
        kind: i.kind, date: i.date, employeeId: i.employeeId, name: nameFromTitle(i.title), departmentName: i.departmentName,
        years: i.kind === 'WORK_ANNIVERSARY' ? i.years : null,
      })),
    joinersKnown: false,
  }
}

/** The small chip under an avatar: "Birthday", "1 yr", "5 yrs", "New". */
export function chipOf(c: Pick<Celebration, 'kind' | 'years'>): string {
  if (c.kind === 'BIRTHDAY') return 'Birthday'
  if (c.kind === 'NEW_JOINER') return 'New'
  if (c.kind === 'WORK_ANNIVERSARY') return c.years && c.years > 0 ? `${c.years} ${c.years === 1 ? 'yr' : 'yrs'}` : 'Anniversary'
  return ''
}

/** Faded: a birthday or anniversary that has already gone by. New joiners are never faded. */
export function isPast(c: Pick<Celebration, 'kind' | 'date'>, today: string): boolean {
  return c.kind !== 'NEW_JOINER' && c.date < today
}

/** "Kavya Menon" → "KM"; "Ravi" → "R". */
export function initialsOfName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

/** Today first, then the soonest, then the ones gone by (most recent first). */
function byWhen(today: string) {
  return (a: Celebration, b: Celebration) => {
    const pa = a.date < today, pb = b.date < today
    if (pa !== pb) return pa ? 1 : -1
    if (a.date !== b.date) return pa ? (a.date < b.date ? 1 : -1) : (a.date < b.date ? -1 : 1)
    return a.name.localeCompare(b.name)
  }
}

/** How far ahead the Home row looks, and how far back it keeps new joiners. */
export const HOME_SOON_DAYS = 7

/**
 * Who goes on the Home row: everything today first (birthdays, anniversaries, anyone who joined
 * today), then birthdays and anniversaries in the next week, then people who joined in the last week.
 * Birthdays and anniversaries that have gone by stay on the page only.
 */
export function homeRow(items: readonly Celebration[], today: string): Celebration[] {
  const soon = plusDays(today, HOME_SOON_DAYS), since = plusDays(today, -HOME_SOON_DAYS)
  const todays = items.filter((c) => c.date === today)
  const coming = items.filter((c) => c.kind !== 'NEW_JOINER' && c.date > today && c.date <= soon)
  const joined = items.filter((c) => c.kind === 'NEW_JOINER' && c.date < today && c.date >= since)
  const order = (a: Celebration, b: Celebration) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1)
  return [...todays.sort((a, b) => a.name.localeCompare(b.name)), ...coming.sort(order), ...joined.sort((a, b) => -order(a, b))]
}

export interface CelebrationSection {
  key: CelebrationKind
  title: string
  /** The friendly line under the title. */
  line: string
  empty: { title: string; hint: string }
  items: Celebration[]
}

export const SECTION_WORDS: Record<CelebrationKind, Omit<CelebrationSection, 'key' | 'items'>> = {
  BIRTHDAY: {
    title: 'Birthdays',
    line: 'A quick “happy birthday” goes a long way. Make their day.',
    empty: { title: 'No birthdays coming up', hint: 'Birthdays show here once a date of birth is on someone’s profile.' },
  },
  WORK_ANNIVERSARY: {
    title: 'Work anniversaries',
    line: 'Another year with the team. Thank them for sticking around.',
    empty: { title: 'No work anniversaries coming up', hint: 'Counted from each person’s joining date, from their first year on.' },
  },
  NEW_JOINER: {
    title: 'Welcome aboard',
    line: 'New faces from the last 30 days. Say hello and help them settle in.',
    empty: { title: 'Nobody new in the last 30 days', hint: 'People who join your company show here for their first month.' },
  },
}

/** The page's three sections, each in its own order (new joiners: newest first). */
export function sectionsOf(data: CelebrationsData, today: string): CelebrationSection[] {
  const kinds: CelebrationKind[] = data.joinersKnown ? ['BIRTHDAY', 'WORK_ANNIVERSARY', 'NEW_JOINER'] : ['BIRTHDAY', 'WORK_ANNIVERSARY']
  return kinds.map((key) => {
    const mine = data.items.filter((c) => c.kind === key)
    const items = key === 'NEW_JOINER'
      ? [...mine].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1))
      : [...mine].sort(byWhen(today))
    return { key, ...SECTION_WORDS[key], items }
  })
}

/** The sub-line under a person on the page: "Today · Engineering", "Joined 3 days ago". */
export function celebrationSub(c: Celebration, today: string): string {
  const when = whenWords(c.date, today)
  const lead = c.kind === 'NEW_JOINER' ? (c.date === today ? 'Joined today' : `Joined ${when === 'Yesterday' ? 'yesterday' : /ago$/.test(when) ? when : `on ${dayMonthOf(c.date)}`}`) : when
  return c.departmentName ? `${lead} · ${c.departmentName}` : lead
}

// ── off this week ───────────────────────────────────────────────────────────

/** Monday to Sunday of the week `today` is in. */
export function weekOf(today: string): { from: string; to: string } {
  const back = (weekdayOfYmd(today) + 6) % 7
  const from = plusDays(today, -back)
  return { from, to: plusDays(from, 6) }
}

export interface OffPerson {
  key: string
  name: string
  /** The days off inside the week, in order. */
  dates: string[]
  /** "Today", "Mon – Wed", "Thu", "Mon, Wed". */
  when: string
  offToday: boolean
  leaveType: string | null
}

/** One team time-off row (GET /v1/team/time-off). */
export interface TeamOffLike {
  kind: string
  status: string
  employeeId: string
  employeeName: string
  fromDate: string
  toDate: string
  leaveTypeName: string | null
}

/** "Mon – Wed" for a run of days, "Mon, Wed" otherwise, "Today" for today alone. */
export function daysWords(dates: readonly string[], today: string): string {
  if (!dates.length) return ''
  if (dates.length === 1) return dates[0] === today ? 'Today' : SHORT_WD[weekdayOfYmd(dates[0])]
  const run = dates.every((d, i) => i === 0 || dayDiff(dates[i - 1], d) === 1)
  if (run) return `${SHORT_WD[weekdayOfYmd(dates[0])]} – ${SHORT_WD[weekdayOfYmd(dates[dates.length - 1])]}`
  return dates.map((d) => SHORT_WD[weekdayOfYmd(d)]).join(', ')
}

function finish(people: Map<string, { name: string; dates: Set<string>; type: string | null }>, today: string): OffPerson[] {
  return [...people.entries()]
    .map(([key, p]) => {
      const dates = [...p.dates].sort()
      return { key, name: p.name, dates, when: daysWords(dates, today), offToday: p.dates.has(today), leaveType: p.type }
    })
    .sort((a, b) => (a.offToday !== b.offToday ? (a.offToday ? -1 : 1) : a.dates[0] !== b.dates[0] ? (a.dates[0] < b.dates[0] ? -1 : 1) : a.name.localeCompare(b.name)))
}

/** Team approvers: approved leave in the team, each person's days inside the week. */
export function offFromTeam(entries: readonly TeamOffLike[], week: { from: string; to: string }, today: string): OffPerson[] {
  const people = new Map<string, { name: string; dates: Set<string>; type: string | null }>()
  for (const e of entries) {
    if (e.kind !== 'LEAVE' || e.status !== 'APPROVED') continue
    const from = e.fromDate > week.from ? e.fromDate : week.from
    const to = e.toDate < week.to ? e.toDate : week.to
    if (from > to) continue
    const p = people.get(e.employeeId) ?? { name: e.employeeName, dates: new Set<string>(), type: e.leaveTypeName }
    for (let d = from; d <= to; d = plusDays(d, 1)) p.dates.add(d)
    people.set(e.employeeId, p)
  }
  return finish(people, today)
}

/** Everyone else: same-department colleagues on approved leave, by first name, per working day. */
export function offFromColleagues(days: readonly { date: string; names: readonly string[] }[], today: string): OffPerson[] {
  const people = new Map<string, { name: string; dates: Set<string>; type: string | null }>()
  for (const d of days) {
    for (const n of d.names) {
      const p = people.get(n) ?? { name: n, dates: new Set<string>(), type: null }
      p.dates.add(d.date.slice(0, 10))
      people.set(n, p)
    }
  }
  return finish(people, today)
}

// ── upcoming holidays ───────────────────────────────────────────────────────

export interface HolidayLike { date: string; name: string; type?: string | null }

/** The next `n` holidays from today on (today included), soonest first, one per day and name. */
export function nextHolidays(list: readonly HolidayLike[], today: string, n = 3): HolidayLike[] {
  const seen = new Set<string>()
  return [...list]
    .filter((h) => !!h.date && h.date.slice(0, 10) >= today)
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))
    .filter((h) => { const k = `${h.date.slice(0, 10)}|${h.name}`; if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, n)
}
