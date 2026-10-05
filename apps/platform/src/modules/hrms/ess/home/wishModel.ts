// "Send wishes" on Celebrations: the pure rules behind the button and the composer on Home's
// Celebrations card and the Celebrations page. THE SAME FILE is in the mobile app
// (components/home/wishModel.ts), byte for byte, so the website and the app offer wishes to the
// same people with the same words. No imports on purpose (as peopleModel.ts): dates are
// yyyy-MM-dd strings worked out in UTC, and "today" always comes from the caller (India's date).
//
// Data (backend V143_84, hrms.celebration_wishes):
//   GET  /v1/ess/celebrations/wishes   { today, received[], receivedPeople, sent[] }: the wishes I got
//                                      in the last week, and the ones I sent (so a button reads "Wished")
//   POST /v1/ess/celebrations/wishes   { toEmployeeId, occasion, message } → { wish, created }.
//                                      Sending the same wish again answers the one already sent
//                                      (created: false); nobody is told twice.
// A server without it (404, or 503 FEATURE_NOT_READY before its migration) offers no wishes: the
// button isn't shown at all, and the cards look exactly as before.

/** The occasions the server knows (hrms.celebration_wishes.occasion). */
export type WishOccasion = 'BIRTHDAY' | 'ANNIVERSARY' | 'WELCOME'

/** The longest message the server takes. */
export const WISH_MAX = 280
/** How far back Welcome aboard reaches (the server's JOINED_DAYS). */
export const WELCOME_DAYS = 30
export const WISH_LABEL = 'Send wishes'
export const WISHED_LABEL = 'Wished ✓'

/** The fields of a celebration (peopleModel.ts Celebration) these rules read. */
export interface WishTarget {
  kind: string
  date: string
  employeeId: string | null
  name: string
  years: number | null
}

function utc(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)))
}
function minusDays(ymd: string, n: number): string {
  const d = new Date(utc(ymd) - n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** The occasion of a celebration kind; null for anything else. */
export function occasionOf(kind: string): WishOccasion | null {
  if (kind === 'BIRTHDAY') return 'BIRTHDAY'
  if (kind === 'WORK_ANNIVERSARY') return 'ANNIVERSARY'
  if (kind === 'NEW_JOINER') return 'WELCOME'
  return null
}

/**
 * Whether the signed-in person may send wishes for this celebration (the server's rules): a
 * birthday or a work anniversary on the day itself, a welcome while the person is on Welcome
 * aboard (joined in the last 30 days, up to today); never themself, so their own id must be known.
 */
export function canWish(c: WishTarget, today: string, myEmployeeId: string | null | undefined): boolean {
  const occasion = occasionOf(c.kind)
  if (!occasion || !c.employeeId || !myEmployeeId || c.employeeId === myEmployeeId) return false
  if (occasion === 'WELCOME') return c.date <= today && c.date >= minusDays(today, WELCOME_DAYS)
  return c.date === today
}

/** "Kavya Menon" → "Kavya". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** The ready-made messages for this celebration, the first one picked to start with. */
export function wishPresets(c: WishTarget): string[] {
  const first = firstNameOf(c.name)
  const occasion = occasionOf(c.kind)
  if (occasion === 'BIRTHDAY') {
    return [`Happy birthday, ${first}! 🎂`, `Many happy returns, ${first}! Have a great day.`, `Wishing you a wonderful year ahead, ${first}! 🎉`]
  }
  if (occasion === 'ANNIVERSARY') {
    const n = c.years && c.years > 0 ? c.years : null
    return [
      n ? `Congratulations on ${n} ${n === 1 ? 'year' : 'years'}! 🎉` : 'Congratulations on your work anniversary! 🎉',
      `Happy work anniversary, ${first}! Thank you for all you do.`,
      'Here’s to many more years together! 🥂',
    ]
  }
  if (occasion === 'WELCOME') {
    return [`Welcome aboard, ${first}! 👋`, `Great to have you with us, ${first}!`, 'Welcome to the team! Shout if you need anything.']
  }
  return []
}

/** The composer's title: "Wish Kavya a happy birthday". */
export function composerTitle(c: WishTarget): string {
  const first = firstNameOf(c.name)
  const occasion = occasionOf(c.kind)
  if (occasion === 'BIRTHDAY') return `Wish ${first} a happy birthday`
  if (occasion === 'ANNIVERSARY') return `Wish ${first} a happy work anniversary`
  return `Welcome ${first} aboard`
}

/** What the composer sends: the person's own words when they wrote any, else the picked message. */
export function wishMessage(preset: string, own: string): string {
  return own.replace(/\s+/g, ' ').trim() || preset
}

// ── sent and received ───────────────────────────────────────────────────────

export interface SentWish { toEmployeeId: string; occasion: string; occasionDate: string }

export interface ReceivedWish {
  id: string
  fromEmployeeId: string
  fromName: string
  occasion: string
  occasionDate: string
  message: string
  createdAt: string
}

export interface WishesData {
  today: string | null
  /** Newest first. */
  received: ReceivedWish[]
  /** How many people sent them. */
  receivedPeople: number
  sent: SentWish[]
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** GET /v1/ess/celebrations/wishes as it comes from the server. */
export function fromWishes(raw: { today?: unknown; received?: unknown; receivedPeople?: unknown; sent?: unknown } | null | undefined): WishesData {
  const received = (Array.isArray(raw?.received) ? (raw!.received as Record<string, unknown>[]) : [])
    .map((w) => ({
      id: text(w.id), fromEmployeeId: text(w.fromEmployeeId), fromName: text(w.fromName).trim() || 'A colleague',
      occasion: text(w.occasion), occasionDate: text(w.occasionDate).slice(0, 10), message: text(w.message), createdAt: text(w.createdAt),
    }))
    .filter((w) => !!w.id && !!w.message)
  const sent = (Array.isArray(raw?.sent) ? (raw!.sent as Record<string, unknown>[]) : [])
    .map((s) => ({ toEmployeeId: text(s.toEmployeeId), occasion: text(s.occasion), occasionDate: text(s.occasionDate).slice(0, 10) }))
    .filter((s) => !!s.toEmployeeId && !!s.occasion && !!s.occasionDate)
  const people = typeof raw?.receivedPeople === 'number' ? raw.receivedPeople : new Set(received.map((w) => w.fromEmployeeId)).size
  return { today: typeof raw?.today === 'string' ? raw.today.slice(0, 10) : null, received, receivedPeople: people, sent }
}

/** The key a wish is remembered by: who, for what, for which day. */
export function wishKey(employeeId: string, occasion: string, date: string): string {
  return `${employeeId}|${occasion}|${date.slice(0, 10)}`
}

/** The keys of the wishes sent, to look a celebration up in. */
export function sentKeys(sent: readonly SentWish[]): Set<string> {
  return new Set(sent.map((s) => wishKey(s.toEmployeeId, s.occasion, s.occasionDate)))
}

/** Whether this celebration's wish was sent already (a birthday's and an anniversary's day is its date; a welcome's, the joining date). */
export function isWished(c: WishTarget, sent: ReadonlySet<string>): boolean {
  const occasion = occasionOf(c.kind)
  return !!occasion && !!c.employeeId && sent.has(wishKey(c.employeeId, occasion, c.date))
}

/** "Priya wished you", "12 people wished you"; '' when nobody has. */
export function receivedLine(data: Pick<WishesData, 'received' | 'receivedPeople'>): string {
  const n = data.receivedPeople
  if (!n || n < 1) return ''
  if (n === 1) return `${firstNameOf(data.received[0]?.fromName ?? 'Someone')} wished you`
  return `${n} people wished you`
}

/** Under a received wish: "Birthday", "Work anniversary", "Welcome". */
export function occasionWords(occasion: string): string {
  if (occasion === 'BIRTHDAY') return 'Birthday'
  if (occasion === 'ANNIVERSARY') return 'Work anniversary'
  if (occasion === 'WELCOME') return 'Welcome'
  return ''
}
