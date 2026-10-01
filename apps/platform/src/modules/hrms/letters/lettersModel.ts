// Pure rules for the Letters pages (P-DOCS): how a letter, a distribution and a
// scheduled send are named and coloured, the date a letter is "Issued", what a
// letter card in My letters says, and the recipients in words. No React, no API.
import type { StatusTone } from '@/design/kit/display'
import type { GeneratedLetterDto, LetterStatus, LetterType } from './api/useLetters'
import type { DistributionJobDto, RecipientFilterType, ScheduledDistribution } from './api/useDistribution'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const LETTER_TYPE_LABEL: Record<LetterType, string> = {
  OFFER: 'Offer Letter', APPOINTMENT: 'Appointment Letter', RELIEVING: 'Relieving Letter',
  EXPERIENCE: 'Experience Letter', SALARY_REVISION: 'Salary Revision Letter', CUSTOM: 'Custom',
}

/** An instant as the day it fell on here (the browser's calendar, India for our users): yyyy-MM-dd. */
export function localDay(instant?: string | null): string | null {
  if (!instant) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return instant
  const d = new Date(instant)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "9 Mar 2026". */
export function dayText(day?: string | null): string {
  if (!day) return '—'
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return `${d} ${MON[m - 1]} ${y}`
}

/** "Mon, 9 Mar" this year, "9 Mar 2025" otherwise (the design's table dates). */
export function shortDay(day?: string | null, today: string = localDay(new Date().toISOString())!): string {
  if (!day) return '—'
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  if (String(y) !== today.slice(0, 4)) return `${d} ${MON[m - 1]} ${y}`
  return `${WD[new Date(y, m - 1, d).getDay()]}, ${d} ${MON[m - 1]}`
}

/** The day a letter counts as issued: the issue date HR chose, else when it was sent, else when it was generated. */
export function issuedDay(l: Pick<GeneratedLetterDto, 'issueDate' | 'sentAt' | 'createdAt'>): string | null {
  return l.issueDate || localDay(l.sentAt) || localDay(l.createdAt)
}

/** The letter's name as people say it: the template's name, else the subject. */
export function letterName(l: Pick<GeneratedLetterDto, 'templateName' | 'subject'>): string {
  return (l.templateName && l.templateName.trim()) || l.subject
}

/** HR's status pill for a letter. GENERATED is a draft: nothing was sent yet. */
export function letterStatus(status: LetterStatus | string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'GENERATED': return { label: 'Draft', tone: 'warning' }
    case 'SENT': return { label: 'Sent', tone: 'success' }
    case 'VIEWED': return { label: 'Viewed', tone: 'success' }
    case 'SIGNED': return { label: 'Signed', tone: 'success' }
    case 'VOID': return { label: 'Void', tone: 'neutral' }
    default: return { label: String(status), tone: 'neutral' }
  }
}

/** HR's signature line for a letter: asked and waiting, or signed (null when none was asked). */
export function signatureNote(l: Pick<GeneratedLetterDto, 'signatureRequested' | 'signedAt' | 'status'>): { label: string; tone: StatusTone } | null {
  if (l.signedAt || l.status === 'SIGNED') return { label: `Signed ${dayText(localDay(l.signedAt))}`.replace(/ —$/, ''), tone: 'success' }
  if (l.signatureRequested && l.status !== 'VOID') return { label: 'Signature asked', tone: 'info' }
  return null
}

/** True when the employee should sign it now (asked, sent, not signed, not withdrawn). */
export function needsMySignature(l: Pick<GeneratedLetterDto, 'signatureRequested' | 'signedAt' | 'status'>): boolean {
  return !!l.signatureRequested && !l.signedAt && (l.status === 'SENT' || l.status === 'VIEWED')
}

export type CardTone = 'done' | 'action' | 'neutral' | 'danger'

/**
 * A letter card in My letters (EmpDocs). Only real states: "Signed" only for a
 * signed letter; letters that need no signature say "Issued"; a letter HR
 * voided after sending says "Withdrawn".
 */
export function myLetterCard(l: GeneratedLetterDto): { tone: CardTone; state: string; sub: string; sign: boolean } {
  const issued = dayText(issuedDay(l))
  if (l.status === 'VOID') return { tone: 'neutral', state: 'Withdrawn', sub: `Withdrawn by HR · ${dayText(localDay(l.voidedAt))}`.replace(/ · —$/, ''), sign: false }
  if (l.status === 'SIGNED' || l.signedAt) return { tone: 'done', state: 'Signed', sub: `Signed ${dayText(localDay(l.signedAt))}`.replace(/ —$/, ''), sign: false }
  if (needsMySignature(l)) {
    const by = l.generatedByName ? `Sent by ${l.generatedByName}` : 'Sent'
    return { tone: 'action', state: 'Needs your signature', sub: `${by} · ${shortDay(localDay(l.sentAt) ?? issuedDay(l))}`, sign: true }
  }
  return { tone: 'done', state: 'Issued', sub: `Issued ${issued}`, sign: false }
}

/** The gold line above My letters: the first letter that needs a signature, and how many more. */
export function signatureBanner(letters: GeneratedLetterDto[]): string | null {
  const waiting = letters.filter(needsMySignature)
  if (!waiting.length) return null
  const first = `Your ${letterName(waiting[0]).replace(/^./, (c) => c.toLowerCase())} needs your e-signature. It takes about a minute.`
  return waiting.length === 1 ? first : `${waiting.length} letters need your e-signature, starting with your ${letterName(waiting[0]).replace(/^./, (c) => c.toLowerCase())}.`
}

/** A distribution's status in the words the server can stand behind: "sent" and "failed", never "delivered". */
export function distributionStatus(j: Pick<DistributionJobDto, 'status' | 'sentCount' | 'failedCount' | 'totalRecipients'>): { label: string; tone: StatusTone } {
  switch (j.status) {
    case 'COMPLETED': return { label: `Sent to ${j.sentCount}`, tone: 'success' }
    case 'PARTIAL_FAILURE': return { label: `${j.sentCount} sent · ${j.failedCount} failed`, tone: 'warning' }
    case 'FAILED': return { label: j.failedCount ? `${j.failedCount} failed` : 'Failed', tone: 'danger' }
    case 'PROCESSING': return { label: `Sending · ${j.sentCount} of ${j.totalRecipients}`, tone: 'info' }
    default: return { label: 'Waiting to send', tone: 'info' }
  }
}

/** A scheduled send's pill. */
export function scheduleStatus(s: Pick<ScheduledDistribution, 'status' | 'sendOn'>): { label: string; tone: StatusTone } {
  if (s.status === 'FAILED') return { label: 'Didn’t start', tone: 'danger' }
  if (s.status === 'STARTING') return { label: 'Starting now', tone: 'info' }
  return { label: `Sends ${shortDay(s.sendOn)}, 9:00`, tone: 'info' }
}

export const RECIPIENT_FILTERS: { value: RecipientFilterType; label: string }[] = [
  { value: 'ALL_EMPLOYEES', label: 'Everyone' },
  { value: 'BY_DEPARTMENT', label: 'By department' },
  { value: 'BY_BRANCH', label: 'By branch' },
  { value: 'BY_DESIGNATION', label: 'By designation' },
  { value: 'BY_EMPLOYMENT_TYPE', label: 'By employment type' },
  { value: 'CUSTOM_LIST', label: 'Pick people' },
]

/** The recipients in words: "Everyone", "Engineering and Sales", "3 people", "Bengaluru HQ". */
export function recipientsText(type: RecipientFilterType, picked: string[]): string {
  if (type === 'ALL_EMPLOYEES') return 'Everyone'
  if (type === 'CUSTOM_LIST') return `${picked.length} ${picked.length === 1 ? 'person' : 'people'}`
  if (!picked.length) return 'No one yet'
  if (picked.length === 1) return picked[0]
  if (picked.length === 2) return `${picked[0]} and ${picked[1]}`
  return `${picked[0]}, ${picked[1]} and ${picked.length - 2} more`
}

/** The day after `today` (yyyy-MM-dd): the first date a send can be scheduled for. */
export function nextDay(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const t = new Date(y, m - 1, d + 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
