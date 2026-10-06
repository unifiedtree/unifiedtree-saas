// Face station (V143.95, spec 14.4): a shared face-punch device at one branch. Design:
// docs/redesign/FACE_STATION.md.
//   Setting up, with the admin's own sign-in (attendance.policy.manage AND attendance.assisted_punch.any):
//     GET /v1/attendance/stations · POST /v1/attendance/stations { name, branchId }
//     POST /v1/attendance/stations/{id}/revoke · DELETE /v1/attendance/stations/{id} (never punched anyone)
//     POST /v1/attendance/stations/{id}/device-session → a station sign-in for THIS computer
//   At the station, with the station's own sign-in (kept in this browser, never the person's session):
//     GET /v1/attendance/station/me · GET /v1/attendance/station/people?q= · POST /v1/attendance/station/punch
//     POST /v1/attendance/station/renew
// The server refuses a station sign-in anywhere else, so the station page can never read other data.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, apiJson, HttpError } from '@/core/api/client'
import { errorCodeOf, httpStatusOf } from '@/core/api/featureNotReady'

export const STATION_PERMS = ['attendance.policy.manage', 'attendance.assisted_punch.any'] as const
export const STATION_SEARCH_MIN = 2

export interface FaceStation {
  id: string; companyId: string; branchId: string; branchName: string | null; name: string
  status: 'ACTIVE' | 'REVOKED'
  createdByName: string | null; createdAt: string | null
  revokedByName: string | null; revokedAt: string | null
  lastStartedAt: string | null; lastStartedByName: string | null; lastUsedAt: string | null
  punchesToday: number; waitingApproval: number
}
export interface StationInfo { stationId: string; name: string; branchId: string | null; branchName: string | null }
export interface StationSession { token: string; expiresAt: string; station: StationInfo }
export interface StationPerson { employeeId: string; fullName: string; employeeCode: string | null; departmentName: string | null; faceReady: boolean }
export interface StationPeople { people: StationPerson[]; truncated: boolean; hint: string | null }
export type StationPunchType = 'CHECK_IN' | 'CHECK_OUT'
export interface StationPunchResult {
  employeeId: string; employeeName: string; employeeCode: string | null; departmentName: string | null; jobTitle: string | null
  type: StationPunchType; punchedAt: string | null; attendanceStatus: string | null; locationName: string | null
  needsApproval: boolean; stationName: string
}

// ── setting up (admin) ───────────────────────────────────────────────────────

const KEY = ['attendance', 'face-stations'] as const

export function useFaceStations(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => apiJson<FaceStation[]>('/v1/attendance/stations'), enabled, staleTime: 15_000 })
}

export function useStationActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  return {
    create: useMutation({
      mutationFn: (body: { name: string; branchId: string }) =>
        apiJson<FaceStation>('/v1/attendance/stations', { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: done,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => apiJson<FaceStation>(`/v1/attendance/stations/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiJson<void>(`/v1/attendance/stations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      onSuccess: done,
    }),
    startHere: useMutation({
      mutationFn: (id: string) => apiJson<StationSession>(`/v1/attendance/stations/${encodeURIComponent(id)}/device-session`, { method: 'POST' }),
    }),
  }
}

// ── the station's own sign-in, in this browser ───────────────────────────────

const STORE_KEY = 'ut.faceStation'

export function saveStation(s: StationSession): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch { /* private window: the page says so */ }
}
export function readStation(): StationSession | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const s = raw ? (JSON.parse(raw) as StationSession) : null
    return s && s.token && s.station?.stationId ? s : null
  } catch {
    return null
  }
}
export function forgetStation(): void {
  try { localStorage.removeItem(STORE_KEY) } catch { /* nothing stored */ }
}

/** A call with the station's sign-in. Errors are HttpError, like apiJson's (status, errorCode, message). */
async function stationJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = readStation()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  if (s?.token) headers.set('Authorization', `Bearer ${s.token}`)
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, credentials: 'omit' })
  const text = await res.text()
  const body = text ? (() => { try { return JSON.parse(text) } catch { return null } })() : null
  if (!res.ok) {
    const message = (body && typeof body.message === 'string' && body.message) || `Request failed (${res.status})`
    throw new HttpError(message, res.status, body)
  }
  return body as T
}

export const stationCalls = {
  me: () => stationJson<StationInfo>('/v1/attendance/station/me'),
  people: (q: string) => stationJson<StationPeople>(`/v1/attendance/station/people?q=${encodeURIComponent(q)}`),
  punch: (body: { employeeId: string; type: StationPunchType; imageBase64: string; challengePerformed?: string; latitude: number; longitude: number; accuracy?: number | null; deviceId?: string }) =>
    stationJson<StationPunchResult>('/v1/attendance/station/punch', { method: 'POST', body: JSON.stringify(body) }),
  renew: () => stationJson<StationSession>('/v1/attendance/station/renew', { method: 'POST' }),
}

// ── rules the pages share (tested in stationModel.test.ts) ───────────────────

export function canSetUpStations(has: (code: string) => boolean): boolean {
  return STATION_PERMS.every((c) => has(c))
}

export function stationSearch(q: string): string | null {
  const s = q.trim()
  return s.length >= STATION_SEARCH_MIN ? s : null
}

/** Renew once less than 29 of the 30 days are left (the page checks every few hours). */
export function shouldRenew(expiresAt: string | null | undefined, now = Date.now()): boolean {
  const t = expiresAt ? Date.parse(expiresAt) : NaN
  return !Number.isFinite(t) || t - now < 29 * 24 * 3600 * 1000
}

export interface StationProblem { title: string; text: string; next: 'camera' | 'start' | 'off' }

/** A refused punch in plain words for the person at the station, by the server's code. */
export function stationProblem(err: unknown): StationProblem {
  const e = { status: httpStatusOf(err), message: err instanceof Error ? err.message : '' }
  const code = errorCodeOf(err) ?? ''
  const said = e.message && !/^Request failed|Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : ''
  if (code === 'STATION_REVOKED' || code === 'STATION_ONLY' || code === 'STATION_ONLY_PUNCHES' || e.status === 401)
    return { title: 'This station is switched off', text: 'Ask your admin to start it again.', next: 'off' }
  if (['FAIL_MATCH', 'FAIL_MATCH_INCONSISTENT'].includes(code)) return { title: 'Face didn’t match', text: said || 'Look straight at the camera and try again.', next: 'camera' }
  if (['FAIL_LIVENESS', 'FAIL_NO_FACE', 'FAIL_MULTIPLE_FACES', 'FAIL_LOW_QUALITY', 'FACE_IMAGE_INVALID', 'FACE_IMAGE_REQUIRED', 'FACE_WORKER_UNAVAILABLE', 'FACE_WORKER_BAD_RESPONSE'].includes(code))
    return { title: 'Face not clear', text: said || 'Look at the camera and try again.', next: 'camera' }
  if (['FACE_NOT_ENROLLED', 'FACE_TEMPLATE_INCOMPLETE'].includes(code)) return { title: 'No face enrolled', text: said || 'Enrol your face once in the app, then punch here.', next: 'start' }
  if (code === 'FACE_LOCKED') return { title: 'Face check locked', text: said || 'It unlocks by itself after a while, or HR can reset it.', next: 'start' }
  if (['ALREADY_CHECKED_IN', 'ALREADY_CHECKED_OUT'].includes(code)) return { title: 'Already punched', text: said || 'You’ve already punched today.', next: 'start' }
  if (code === 'NOT_CHECKED_IN') return { title: 'Not punched in yet', text: said || 'Punch in first.', next: 'start' }
  if (['STATION_OTHER_BRANCH', 'ASSISTED_PUNCH_NOT_ACTIVE'].includes(code)) return { title: 'Can’t punch here', text: said || 'You can’t punch at this station.', next: 'start' }
  if (code === 'OUTSIDE_GEOFENCE') return { title: 'Station outside the work area', text: said || 'Ask your admin to check where the station is set up.', next: 'start' }
  if (code === 'LOCATION_REQUIRED') return { title: 'Location needed', text: said || 'Allow location for this site, then try again.', next: 'camera' }
  if (!e.status || e.status >= 500) return { title: 'Couldn’t reach the server', text: 'Check the connection and try again.', next: 'camera' }
  return { title: 'Couldn’t punch', text: said || 'Please try again.', next: 'camera' }
}

/** The success card's two lines. */
export function successLines(r: { type: StationPunchType; employeeName: string; needsApproval: boolean }) {
  const first = (r.employeeName || '').trim().split(/\s+/)[0] || 'there'
  return {
    title: r.type === 'CHECK_IN' ? `Punched in · welcome, ${first}` : `Punched out · bye, ${first}`,
    note: r.needsApproval ? 'Recorded. The face match wasn’t certain, so your manager will confirm this punch.' : 'Recorded. You’re all set.',
  }
}
