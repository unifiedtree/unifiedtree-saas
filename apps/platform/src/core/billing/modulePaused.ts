// "Payment needed": a module paused after the payment grace (contract 2, _results/chakri/CONTRACTS-PROPOSAL.md).
// The server refuses the unpaid module's calls with 402 { code: 'MODULE_PAUSED', moduleKey, dueAmountInr,
// dueSince, graceEndedOn, canPay, message }. The API client reports it here; the shell then shows the
// payment-needed screen in place of the page (ModulePausedScreen), except on the pages that stay open while
// paused: sign-in, the plan and billing pages, notifications.
// A server without the change answers as before (no MODULE_PAUSED code), so nothing here shows.
import { useSyncExternalStore } from 'react'

export interface ModulePaused {
  code: 'MODULE_PAUSED'
  moduleKey: string
  companyId?: string | null
  /** May be null: the server doesn't know the amount. */
  dueAmountInr?: number | null
  dueSince?: string | null
  graceEndedOn?: string | null
  /** The person may pay (the billing permission); others are asked to tell their owner. */
  canPay?: boolean
  message?: string | null
}

/** The body of a 402 when it is MODULE_PAUSED, else null. */
export function asModulePaused(status: number, body: unknown): ModulePaused | null {
  if (status !== 402 || !body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.code !== 'MODULE_PAUSED') return null
  return {
    code: 'MODULE_PAUSED',
    moduleKey: typeof b.moduleKey === 'string' && b.moduleKey ? b.moduleKey : 'hrms',
    companyId: typeof b.companyId === 'string' ? b.companyId : null,
    dueAmountInr: typeof b.dueAmountInr === 'number' ? b.dueAmountInr : null,
    dueSince: typeof b.dueSince === 'string' ? b.dueSince : null,
    graceEndedOn: typeof b.graceEndedOn === 'string' ? b.graceEndedOn : null,
    canPay: b.canPay === true,
    message: typeof b.message === 'string' && b.message.trim() ? b.message.trim() : null,
  }
}

/** Pages that stay open while a module is paused (the server keeps their APIs open too). */
const OPEN_WHILE_PAUSED = ['/login', '/signup', '/plan', '/settings/billing', '/billing', '/notifications', '/account']

export function openWhilePaused(pathname: string): boolean {
  return OPEN_WHILE_PAUSED.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

let current: ModulePaused | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function reportModulePaused(p: ModulePaused) {
  if (current && JSON.stringify(current) === JSON.stringify(p)) return
  current = p
  emit()
}

export function clearModulePaused() {
  if (!current) return
  current = null
  emit()
}

export function getModulePaused(): ModulePaused | null {
  return current
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The paused module the last refused call reported (null when nothing is paused). */
export function useModulePaused(): ModulePaused | null {
  return useSyncExternalStore(subscribe, getModulePaused, getModulePaused)
}

const MODULE_NAME: Record<string, string> = { hrms: 'HRMS' }
export const moduleName = (key: string) => MODULE_NAME[key] || key.charAt(0).toUpperCase() + key.slice(1)

/** "₹12,000", or null without an amount. */
export const dueText = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? '₹' + Math.round(n).toLocaleString('en-IN') : null)
