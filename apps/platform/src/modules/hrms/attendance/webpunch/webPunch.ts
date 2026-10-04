// Checking in and out from the browser, with a face scan (client decision, 1 Oct: "web punches use a
// face scan, like the phone"). The same steps the mobile app takes for its punch:
//   1. the browser's location, then the pre-punch zone check (POST /v1/attendance/geo-fence/check:
//      inside the zone, or an approved work-from-home day, or "Anywhere");
//   2. one photo from the camera, prepared as the phone and the web enrollment prepare theirs;
//   3. the punch: POST /v1/attendance/checkin | /checkout with method WEB, the location and the photo.
//      The server matches the photo against the person's enrolled face (the phone's face check)
//      before it records anything, and applies the zone rule again.
import { apiJson } from '@/core/api/client'
import { errorCodeOf, httpStatusOf } from '@/core/api/featureNotReady'
import type { AttendanceDto } from '../../api/useAttendance'

export type PunchMode = 'in' | 'out'

export interface GeoCheck { withinFence: boolean; branchId?: string | null; branchName?: string | null; distanceMeters?: number | null; message?: string | null }
export interface Spot { latitude: number; longitude: number; accuracy: number | null }

/** The browser's position, once. Rejects with a GeolocationPositionError-like object. */
export function locate(timeoutMs = 15_000): Promise<Spot> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(Object.assign(new Error('No geolocation'), { code: 0 }))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}

/** Why the location couldn't be read (GeolocationPositionError codes). */
export function locationErrorText(err: unknown): string {
  switch ((err as { code?: number } | null)?.code) {
    case 1: return 'Location access is blocked. Allow location for this site (the icon in the address bar), then try again.'
    case 2: return 'Your location couldn’t be found. Turn on location services on this device, then try again.'
    case 3: return 'Finding your location took too long. Try again.'
    default: return 'This browser can’t share your location here. Use a recent Chrome, Edge, Firefox or Safari.'
  }
}

export const geoCheck = (s: Spot) =>
  apiJson<GeoCheck>('/v1/attendance/geo-fence/check', { method: 'POST', body: JSON.stringify({ latitude: s.latitude, longitude: s.longitude }) })

/** "Web browser (Chrome on Windows)": the device column of the face log and the record. */
export function deviceLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const what = [browser, os].filter(Boolean).join(' on ')
  return what ? `Web browser (${what})` : 'Web browser'
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * The punch itself. `face`: the photo, plain base64 JPEG. A check-in also sends the browser's
 * accuracy, which only the punch-in alert shows ("±15 m"); a server without it ignores it.
 */
export function punch(mode: PunchMode, spot: Spot, face: string, place?: string | null): Promise<AttendanceDto> {
  const common = { latitude: spot.latitude, longitude: spot.longitude, faceImageBase64: face, deviceId: deviceLabel(), ...(place ? { locationName: place } : {}) }
  const accuracy = spot.accuracy != null && Number.isFinite(spot.accuracy) ? { accuracy: Math.round(spot.accuracy * 10) / 10 } : {}
  return mode === 'in'
    ? apiJson<AttendanceDto>('/v1/attendance/checkin', { method: 'POST', body: JSON.stringify({ ...common, ...accuracy, checkInMethod: 'WEB', clientEventId: newId(), offlineCaptured: false }) })
    : apiJson<AttendanceDto>('/v1/attendance/checkout', { method: 'POST', body: JSON.stringify({ ...common, checkOutMethod: 'WEB', offlineCaptured: false }) })
}

/** What the dialog does next after a refused punch. */
export type Refusal =
  | { kind: 'retry'; text: string }        // take the photo again (no face, no match, blurry…)
  | { kind: 'enroll'; text: string }       // no face on record
  | { kind: 'stop'; text: string }         // nothing to do here now (locked, switched off, already punched…)

/** A refused punch in plain words, by the server's code. */
export function punchRefusal(err: unknown, mode: PunchMode): Refusal {
  const code = errorCodeOf(err)
  const status = httpStatusOf(err)
  const said = err instanceof Error ? err.message.replace(/^[A-Z][A-Z0-9_]{3,}:/, '').trim() : ''
  const verb = mode === 'in' ? 'check in' : 'check out'
  switch (code) {
    case 'FACE_NOT_ENROLLED': return { kind: 'enroll', text: 'Your face isn’t enrolled yet. Enrol it once, then check in.' }
    case 'FACE_TEMPLATE_INCOMPLETE': return { kind: 'stop', text: 'Your face enrolment isn’t complete. Ask HR to reset it, then enrol again.' }
    case 'FACE_LOCKED': return { kind: 'stop', text: 'The face check is locked after several failed tries. It unlocks by itself after a while, or HR can reset it.' }
    case 'FAIL_MATCH': case 'FAIL_MATCH_INCONSISTENT': return { kind: 'retry', text: 'That doesn’t look like your enrolled face. Look straight at the camera, in even light, and try again.' }
    case 'FAIL_LIVENESS': return { kind: 'retry', text: 'We couldn’t confirm a live face. Look at the camera, blink, and try again.' }
    case 'FAIL_NO_FACE': return { kind: 'retry', text: 'We can’t see a face. Keep your face inside the guide and try again.' }
    case 'FAIL_MULTIPLE_FACES': return { kind: 'retry', text: 'More than one face is in the picture. Make sure only you are in the frame.' }
    case 'FAIL_LOW_QUALITY': return { kind: 'retry', text: 'The picture wasn’t sharp enough. Hold still, in even light, and try again.' }
    case 'FACE_WORKER_UNAVAILABLE': case 'FACE_WORKER_BAD_RESPONSE': return { kind: 'retry', text: 'The face check isn’t available right now. Try again in a moment.' }
    case 'FACE_DISABLED': return { kind: 'stop', text: 'Face check is turned off for this workspace, so you can’t check in from the web. Ask your admin.' }
    case 'FACE_VERIFY_NOT_ALLOWED': return { kind: 'stop', text: 'Your access doesn’t include the face check, so you can’t check in or out from the web. Ask your admin.' }
    case 'FACE_IMAGE_REQUIRED': case 'FACE_IMAGE_INVALID': return { kind: 'retry', text: 'The photo couldn’t be read. Take it again.' }
    case 'WEB_PUNCH_NOT_ALLOWED': return { kind: 'stop', text: 'Web check-in is turned off for your company. Check in and out from the mobile app.' }
    case 'LOCATION_REQUIRED': return { kind: 'stop', text: 'Your location is needed to check in or out from the web. Allow location for this site and try again.' }
    case 'OUTSIDE_GEOFENCE': return { kind: 'stop', text: said || `You’re outside your work area. Move inside it to ${verb}.` }
    case 'ALREADY_CHECKED_IN': return { kind: 'stop', text: 'You’ve already checked in today.' }
    case 'ALREADY_CHECKED_OUT': return { kind: 'stop', text: 'You’ve already checked out today.' }
    case 'NOT_CHECKED_IN': return { kind: 'stop', text: 'You haven’t checked in yet, so there’s nothing to check out.' }
  }
  if (status === 401) return { kind: 'stop', text: 'Your session has ended. Sign in again.' }
  if (status === 403) return { kind: 'stop', text: `Your role can’t ${verb} from the web. Ask your admin.` }
  if (status === 404 && mode === 'out') return { kind: 'stop', text: 'You haven’t checked in yet, so there’s nothing to check out.' }
  if (status === 429) return { kind: 'retry', text: 'Too many tries. Wait a minute, then try again.' }
  if (status === undefined && err instanceof TypeError) return { kind: 'retry', text: 'Can’t reach the server. Check your connection and try again.' }
  if (status && status >= 500) return { kind: 'retry', text: `We couldn’t ${verb} just now. Try again in a moment.` }
  return { kind: 'retry', text: said && !/^Request failed/.test(said) ? said : `We couldn’t ${verb}. Try again.` }
}

/** "9:14 AM" in IST. */
export function clockIst(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}
