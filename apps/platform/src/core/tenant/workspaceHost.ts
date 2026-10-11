// Which kind of address the app was opened on, decided before anything
// workspace-like (sign-in, branding, session) is shown.
//
//   <business>.unifiedtree.com   a business: its sign-in, with its branding
//   tata.unifiedtree.com         no such business: "This workspace doesn't exist", no sign-in
//   admin. / marketing. / app.   UnifiedTree's own addresses (the backend's
//                                ReservedSubdomains list): a neutral page, no sign-in
//   suspended / closed business  "This workspace isn't available", no sign-in
//   localhost, 127.0.0.1, *.vercel.app previews, nested hosts: not a workspace
//                                host at all, so the app runs as before
//
// The answer comes from the backend's public sign-in lookup
// (GET /v1/public/workspace-branding?subdomain=), the same call the sign-in
// page already makes for the name and logo; the gate hands its answer to the
// branding store so the page does not ask twice. Anything that is not a clear
// answer (network error, rate limit, server error, slow server) lets the app
// run exactly as it did before: only a definite "not found" or "reserved"
// replaces the sign-in.
import { apiJson, HttpError } from '@/core/api/client'
import type { BrandingDto } from '@/core/tenant/workspaceBranding'

export type PublicBranding = BrandingDto & { status?: string | null }

export type WorkspaceHostState =
  | { kind: 'platform' }
  | { kind: 'checking' }
  | { kind: 'open'; branding: PublicBranding }
  | { kind: 'unavailable'; branding: PublicBranding }
  | { kind: 'not_found' }
  | { kind: 'reserved' }
  | { kind: 'unknown' }

/** Statuses (platform.tenants.status) whose business can't be signed in to. */
const CLOSED_STATUSES = new Set(['SUSPENDED', 'TERMINATED', 'REJECTED'])

/** A business was found: open (ACTIVE, or PENDING_APPROVAL, which keeps today's flow) or not. */
export function stateForBranding(branding: PublicBranding): WorkspaceHostState {
  const status = (branding.status || '').toUpperCase()
  return CLOSED_STATUSES.has(status) ? { kind: 'unavailable', branding } : { kind: 'open', branding }
}

/**
 * The lookup failed: a definite "no business here" (404 with the backend's
 * code, or, from a server older than the code, its "Workspace not found"
 * message), or anything else, which is not an answer.
 */
export function stateForError(e: unknown): WorkspaceHostState {
  if (!(e instanceof HttpError) || e.status !== 404) return { kind: 'unknown' }
  const body = (e.payload ?? {}) as { errorCode?: string; message?: string }
  if (body.errorCode === 'WORKSPACE_RESERVED') return { kind: 'reserved' }
  if (body.errorCode === 'WORKSPACE_NOT_FOUND' || body.message === 'Workspace not found') return { kind: 'not_found' }
  return { kind: 'unknown' }
}

/** Longer than this and the app runs as before rather than keep a blank screen. */
export const RESOLVE_TIMEOUT_MS = 10_000

type Lookup = (path: string) => Promise<PublicBranding>

/** Ask the backend what is at this workspace address. Never throws. */
export async function resolveWorkspaceHost(
  subdomain: string,
  lookup: Lookup = (path) => apiJson<PublicBranding>(path),
  timeoutMs = RESOLVE_TIMEOUT_MS,
): Promise<WorkspaceHostState> {
  if (!subdomain) return { kind: 'platform' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<WorkspaceHostState>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'unknown' }), timeoutMs)
  })
  const answer = lookup(`/v1/public/workspace-branding?subdomain=${encodeURIComponent(subdomain)}`)
    .then(stateForBranding, stateForError)
  try {
    return await Promise.race([answer, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// One lookup per page load, shared (React's StrictMode mounts the gate twice in development).
let shared: { subdomain: string; promise: Promise<WorkspaceHostState>; answer: WorkspaceHostState | null } | null = null
export function resolveWorkspaceHostOnce(subdomain: string): Promise<WorkspaceHostState> {
  if (!shared || shared.subdomain !== subdomain) {
    const entry: NonNullable<typeof shared> = { subdomain, promise: resolveWorkspaceHost(subdomain), answer: null }
    // Kept before the gate hears it, so the app it then renders can read it at once.
    void entry.promise.then((s) => { entry.answer = s })
    shared = entry
  }
  return shared.promise
}

/**
 * This page load's answer for the address, once it has come back (the gate waits for it before it renders
 * the app), else null. The sign-in page reads it at its first render (silentSignIn.ts).
 */
export function workspaceHostAnswer(subdomain: string): WorkspaceHostState | null {
  return shared && shared.subdomain === subdomain ? shared.answer : null
}
