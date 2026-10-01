// Pure rules for the Employee vault, My documents and My assets (P-DOCS): what a
// document's card and pills say, expiry, the gold "needs you" line, and an
// asset's card. No React, no API.
import type { StatusTone } from '@/design/kit/display'
import type { EmployeeDocumentV2 } from '../api/useDocument'
import type { MyAssetCare } from '../onboarding/myAssetsApi'
import { problemLabel } from '../onboarding/myAssetsApi'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14 Mar 2022" from yyyy-MM-dd or an instant (the browser's own calendar). */
export function day(value?: string | null): string {
  if (!value) return '—'
  let y: number, m: number, d: number
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) [y, m, d] = value.split('-').map(Number)
  else { const t = new Date(value); if (Number.isNaN(t.getTime())) return '—'; y = t.getFullYear(); m = t.getMonth() + 1; d = t.getDate() }
  return `${d} ${MON[m - 1]} ${y}`
}

/** Days from `today` to `iso` (both yyyy-MM-dd); negative when it's past. */
export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5)
}

/** Expired, or expiring within 30 days; null otherwise (and for documents with no expiry). */
export function expiryState(expiryDate: string | null | undefined, today: string): { tone: StatusTone; label: string; expired: boolean } | null {
  if (!expiryDate) return null
  const n = daysUntil(expiryDate, today)
  if (n < 0) return { tone: 'danger', label: 'Expired', expired: true }
  if (n <= 30) return { tone: 'warning', label: n === 0 ? 'Expires today' : `Expires in ${n} ${n === 1 ? 'day' : 'days'}`, expired: false }
  return null
}

/** The review pill HR sees; an expired document says Expired, as the design does. */
export function reviewPill(d: Pick<EmployeeDocumentV2, 'verificationStatus' | 'expiryDate'>, today: string): { tone: StatusTone; label: string } | null {
  if (d.verificationStatus !== 'REJECTED' && expiryState(d.expiryDate, today)?.expired) return { tone: 'danger', label: 'Expired' }
  switch (d.verificationStatus) {
    case 'VERIFIED': return { tone: 'success', label: 'Verified' }
    case 'PENDING': return { tone: 'warning', label: 'Waiting for review' }
    case 'REJECTED': return { tone: 'danger', label: 'Rejected' }
    default: return null
  }
}

export type CardTone = 'done' | 'action' | 'neutral' | 'danger'

/**
 * A document's card in My documents (EmpDocs e-files):
 *   rejected → gold ring, "Upload again", and HR's reason
 *   waiting for HR → "Waiting for HR"
 *   expired → red "Expired"
 *   verified, or added by HR → "Verified" / "On file"
 */
export function documentCard(d: EmployeeDocumentV2, today: string): { tone: CardTone; state: string; sub: string; redo: boolean } {
  const exp = expiryState(d.expiryDate, today)
  if (d.verificationStatus === 'REJECTED') {
    return { tone: 'action', state: 'Upload again', sub: [d.rejectionReason || 'HR couldn’t accept it', day(d.verifiedAt ?? d.createdAt)].join(' · '), redo: true }
  }
  if (d.verificationStatus === 'PENDING') return { tone: 'neutral', state: 'Waiting for HR', sub: `Uploaded ${day(d.createdAt)} · HR will check it`, redo: false }
  if (exp?.expired) return { tone: 'danger', state: 'Expired', sub: `Expired ${day(d.expiryDate)}`, redo: true }
  const when = d.verificationStatus === 'VERIFIED' ? `Verified · ${day(d.verifiedAt ?? d.issuedDate ?? d.createdAt)}` : `Added by HR · ${day(d.issuedDate ?? d.createdAt)}`
  return { tone: 'done', state: d.verificationStatus === 'VERIFIED' ? 'Verified' : 'On file', sub: exp ? `${when} · ${exp.label.toLowerCase()}` : when, redo: false }
}

/** The gold line above My documents: a rejected document first, else required types still missing. */
export function documentsBanner(docs: EmployeeDocumentV2[], missing: { displayName: string }[]): string | null {
  const rejected = docs.find((d) => d.verificationStatus === 'REJECTED')
  if (rejected) {
    const what = (rejected.documentTypeName || rejected.title).replace(/^./, (c) => c.toLowerCase())
    return `HR couldn’t accept your ${what}${rejected.rejectionReason ? `: ${rejected.rejectionReason}` : ''}. Upload a new copy.`
  }
  if (missing.length === 1) return `HR still needs your ${missing[0].displayName}. Upload it below.`
  if (missing.length > 1) return `HR still needs ${missing.length} documents from you, starting with your ${missing[0].displayName}.`
  return null
}

/** An asset's card in My assets (EmpDocs e-assets). */
export function assetCard(a: MyAssetCare): { tone: CardTone; state: string; sub: string; confirm: boolean } {
  const sub = [a.assetTag, a.assignedAt ? `handed over ${day(a.assignedAt)}` : null].filter(Boolean).join(' · ')
  if (a.canConfirm) return { tone: 'action', state: 'Confirm you got it', sub, confirm: true }
  if (a.openIssue) return { tone: 'neutral', state: problemLabel(a.openIssue.kind), sub: `${sub} · HR is looking into it`, confirm: false }
  return { tone: 'done', state: 'With you', sub, confirm: false }
}

/** The gold line above My assets: the first asset waiting for a confirmation. */
export function assetsBanner(assets: MyAssetCare[]): string | null {
  const waiting = assets.filter((a) => a.withMe && a.canConfirm)
  if (!waiting.length) return null
  if (waiting.length === 1) return `Did you get the ${waiting[0].assetName}? Confirm it so it’s recorded against you.`
  return `${waiting.length} items are waiting for you to confirm you got them, starting with the ${waiting[0].assetName}.`
}
