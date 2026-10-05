// One email per employee in the workspace (owner, 2026-10-05). The add / edit / invite forms ask
// the server as you type (debounced) whether an email is already someone's, and say who on the
// field; the save checks again and answers 409 EMAIL_ALREADY_USED, which the forms put on the
// same field. Phone numbers are only a warning ("Also used by …"): people do share them.
//   GET /v1/employees/email-check?email=&excludeEmployeeId= → { available, ownerName?, ownerCode?, message? }
//   GET /v1/employees/phone-check?phone=&excludeEmployeeId= → { inUse, count, usedBy[], message? }
// A check that fails (no permission, the server not updated yet) says nothing and never blocks:
// the server's own check at save time still applies.
import { useCallback, useEffect, useRef, useState } from 'react'
import { HttpError, apiJson } from '@/core/api/client'

export const EMAIL_ALREADY_USED = 'EMAIL_ALREADY_USED'
const DEBOUNCE_MS = 400
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface EmailCheckResult {
  available: boolean
  ownerName?: string | null
  ownerCode?: string | null
  ownerLeft?: boolean
  field?: 'WORK' | 'PERSONAL' | 'LOGIN' | null
  message?: string | null
}

export interface PhoneCheckResult {
  inUse: boolean
  count: number
  usedBy: { name: string; code?: string | null; left?: boolean }[]
  message?: string | null
}

/** Trimmed and lower-cased — the form the server compares and saves emails in. */
export const normalizeEmail = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
/** The last ten digits, as the server compares numbers. */
export const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10)

const query = (params: Record<string, string | undefined>) =>
  Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

export function checkEmail(email: string, excludeEmployeeId?: string): Promise<EmailCheckResult> {
  return apiJson<EmailCheckResult>(`/v1/employees/email-check?${query({ email: normalizeEmail(email), excludeEmployeeId })}`)
}

export function checkPhone(phone: string, excludeEmployeeId?: string): Promise<PhoneCheckResult> {
  return apiJson<PhoneCheckResult>(`/v1/employees/phone-check?${query({ phone: phone.trim(), excludeEmployeeId })}`)
}

/** The message of a 409 EMAIL_ALREADY_USED from a save, for the email field; null for any other error. */
export function emailConflictMessage(err: unknown): string | null {
  if (!(err instanceof HttpError) && !(err && typeof err === 'object' && 'status' in err)) return null
  const e = err as { status?: number; message?: string; payload?: { errorCode?: string; message?: string } }
  if (e.payload?.errorCode !== EMAIL_ALREADY_USED) return null
  return e.payload?.message || e.message || 'This email is already used by another employee in this workspace.'
}

interface CheckOptions {
  /** The person being edited (left out of the check); none when adding someone. */
  excludeEmployeeId?: string
  /** The value the field started with: unchanged means nothing to check. */
  initial?: string | null
  enabled?: boolean
}

/**
 * The email field's "already used" message while typing (null when free, unchecked or the check
 * failed), and `settle()` for Save: the answer for the current value right away (cached when the
 * debounced check already has it).
 */
export function useEmailCheck(email: string, { excludeEmployeeId, initial, enabled = true }: CheckOptions = {}) {
  const key = normalizeEmail(email)
  const skip = !enabled || !EMAIL_RX.test(key) || (initial != null && key === normalizeEmail(initial))
  const [state, setState] = useState<{ key: string; message: string | null }>({ key: '', message: null })
  const [checking, setChecking] = useState(false)
  const cache = useRef(new Map<string, string | null>())

  const run = useCallback(async (k: string): Promise<string | null> => {
    const ck = `${excludeEmployeeId ?? ''}|${k}`
    if (cache.current.has(ck)) return cache.current.get(ck)!
    try {
      const r = await checkEmail(k, excludeEmployeeId)
      const message = r.available ? null : (r.message || 'This email is already used by another employee in this workspace.')
      cache.current.set(ck, message)
      return message
    } catch {
      return null
    }
  }, [excludeEmployeeId])

  useEffect(() => {
    if (skip) { setChecking(false); return }
    let live = true
    setChecking(true)
    const t = setTimeout(() => {
      void run(key).then((message) => { if (live) { setState({ key, message }); setChecking(false) } })
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [key, skip, run])

  const settle = useCallback(async () => (skip ? null : run(key)), [skip, key, run])
  return { message: !skip && state.key === key ? state.message : null, checking, settle }
}

/** "Also used by …" under a phone field (null when nobody else has it, or the check failed). Never blocks. */
export function usePhoneWarning(phone: string, { excludeEmployeeId, initial, enabled = true }: CheckOptions = {}) {
  const k = phoneKey(phone)
  const skip = !enabled || k.length < 7 || (initial != null && k === phoneKey(initial))
  const [state, setState] = useState<{ key: string; warning: string | null }>({ key: '', warning: null })
  // The number as typed is what is sent; its digits (`k`) decide whether to ask again.
  const latest = useRef(phone)
  latest.current = phone

  useEffect(() => {
    if (skip) return
    let live = true
    const t = setTimeout(() => {
      checkPhone(latest.current, excludeEmployeeId)
        .then((r) => { if (live) setState({ key: k, warning: r.inUse ? (r.message || 'This number is also used by another employee.') : null }) })
        .catch(() => { if (live) setState({ key: k, warning: null }) })
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [k, skip, excludeEmployeeId])

  return !skip && state.key === k ? state.warning : null
}
