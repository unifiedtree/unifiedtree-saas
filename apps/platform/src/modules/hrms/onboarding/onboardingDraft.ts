/**
 * Keeps an in-progress "Add a hire" wizard alive across a page reload.
 *
 * Only the typed answers are kept, and only in this browser. Uploaded files
 * and the identity/bank numbers below are deliberately left out: a draft can
 * outlive the session on a shared machine, and none of it is needed to carry
 * on typing — the admin re-enters those on the Documents and Payroll steps.
 */

const TTL_MS = 24 * 60 * 60 * 1000

const keyFor = (tenantId: string, userId: string) => `ut.onboarding.draft.v1:${tenantId}:${userId}`

/** Never written to disk. Identity and bank numbers, and the photo blob URL. */
const OMIT = [
  'accountNumber',
  'ifsc',
  'panNumber',
  'aadhaarNumber',
  'uanNumber',
  'esiNumber',
  'dateOfBirth',
] as const

export interface OnboardingDraft<F> {
  at: number
  step: string
  reached: number
  form: F
  assets: unknown[]
  policyPack: Record<string, boolean>
  checklist: Record<string, boolean>
}

export function readDraft<F>(tenantId?: string, userId?: string): OnboardingDraft<F> | null {
  if (!tenantId || !userId) return null
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId, userId))
    if (!raw) return null
    const d = JSON.parse(raw) as OnboardingDraft<F>
    if (!d || typeof d.at !== 'number' || Date.now() - d.at > TTL_MS) {
      window.localStorage.removeItem(keyFor(tenantId, userId))
      return null
    }
    return d && typeof d.form === 'object' && d.form !== null ? d : null
  } catch {
    return null
  }
}

export function writeDraft<F extends Record<string, unknown>>(
  tenantId: string | undefined,
  userId: string | undefined,
  draft: Omit<OnboardingDraft<F>, 'at'>,
): void {
  if (!tenantId || !userId) return
  try {
    const form = { ...draft.form } as Record<string, unknown>
    for (const k of OMIT) delete form[k]
    window.localStorage.setItem(
      keyFor(tenantId, userId),
      JSON.stringify({ ...draft, form, at: Date.now() }),
    )
  } catch {
    /* private window, or the quota is full — the wizard still works. */
  }
}

export function clearDraft(tenantId?: string, userId?: string): void {
  if (!tenantId || !userId) return
  try {
    window.localStorage.removeItem(keyFor(tenantId, userId))
  } catch {
    /* nothing to do */
  }
}

/** True when the draft holds something worth offering to restore. */
export function draftHasContent<F extends Record<string, unknown>>(d: OnboardingDraft<F> | null): boolean {
  if (!d) return false
  if (d.reached > 0) return true
  return Object.values(d.form).some((v) => (typeof v === 'string' ? v.trim() !== '' : false))
}
