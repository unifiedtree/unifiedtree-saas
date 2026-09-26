import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { apiJson, HttpError } from '@/core/api/client'
import type { PillTone } from '@/shared/components/hr'

// Face enrollment on the web (camera), for yourself or — HR / admin — for
// someone else. The same endpoints the mobile app's face-enroll screen uses
// (backend FaceController): start, one photo per angle, complete. The server's
// face worker finds the face and makes the encrypted face pattern from each
// JPEG; nothing about the face model runs in the browser, and the photos are
// not stored. Someone else's routes take their HR employee id; the server maps
// it to their login, which is what face data is keyed by.

export type CaptureAngle = 'FRONT' | 'LEFT_30' | 'RIGHT_30' | 'UP_15' | 'VARIED_LIGHT'
export type Challenge = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT' | 'NOD' | 'SMILE'
export type FaceEnrollmentStatus = 'PENDING' | 'ACTIVE' | 'NEEDS_REENROLLMENT' | 'LOCKED' | 'REVOKED'

/** GET …/enrollment-status (yours) or …/admin/employees/{id}/enrollment-status (someone else's, with hasLogin). */
export interface FaceStatus {
  hasLogin?: boolean
  status: FaceEnrollmentStatus
  samplesRequired: number
  samplesCaptured: number
  remainingAngles: CaptureAngle[]
  lockedRequiresManagerReset: boolean
  enrolledAt?: string | null
  /** LOCKED only: when the lock clears by itself (null: only HR can clear it; missing: an older server). */
  unlocksAt?: string | null
}

/** `workerHint`: whether the server could reach its face check service when the enrollment started. */
interface StartResponse { enrollmentId: string; samplesRequired: number; captureSequence: CaptureAngle[]; workerHint?: string }
export interface SampleResponse {
  accepted: boolean
  capturedAngle: CaptureAngle
  samplesCaptured: number
  samplesRequired: number
  rejectionCode?: string | null
  rejectionReason?: string | null
  remainingAngles: CaptureAngle[]
}

/** Whose face: the signed-in person's, or an employee's (HR / admin, `attendance.face.admin.reset`). */
export type FaceTarget = { kind: 'self' } | { kind: 'employee'; employeeId: string; name: string }

const root = (t: FaceTarget) => (t.kind === 'self' ? '/v1/attendance/face' : `/v1/attendance/face/admin/employees/${t.employeeId}`)
/** Recorded with each photo (the face log's device column), so a web enrollment is told apart from the phone's. */
const deviceOf = (t: FaceTarget) => (t.kind === 'self' ? 'Web browser' : 'Web browser (HR)')

export const faceStatusKey = (t: FaceTarget) => ['hrms', 'attendance', 'face', 'status', t.kind === 'self' ? 'me' : t.employeeId]

export function useFaceStatus(target: FaceTarget, enabled = true) {
  return useQuery({
    queryKey: faceStatusKey(target),
    queryFn: () => apiJson<FaceStatus>(`${root(target)}/enrollment-status`),
    enabled,
    staleTime: 30_000,
  })
}

export const faceEnrollApi = {
  start: (t: FaceTarget) => apiJson<StartResponse>(`${root(t)}/enroll/start`, { method: 'POST', body: JSON.stringify({ deviceFingerprint: deviceOf(t) }) }),
  sample: (t: FaceTarget, body: { enrollmentId: string; captureAngle: CaptureAngle; imageBase64: string; challengePerformed: Challenge }) =>
    apiJson<SampleResponse>(`${root(t)}/enroll/sample`, { method: 'POST', body: JSON.stringify({ ...body, deviceFingerprint: deviceOf(t) }) }),
  complete: (t: FaceTarget) => apiJson<{ status: FaceEnrollmentStatus }>(`${root(t)}/enroll/complete`, { method: 'POST', body: '{}' }),
}

// ── the photos ───────────────────────────────────────────────────────────────

/** The server's order when it doesn't say otherwise (FaceService.CAPTURE_SEQUENCE). */
export const DEFAULT_SEQUENCE: CaptureAngle[] = ['FRONT', 'LEFT_30', 'RIGHT_30']

/** What to ask for at each angle, and the challenge the phone app reports with it. */
export const ANGLE: Record<CaptureAngle, { label: string; prompt: string; help: string; challenge: Challenge; turn: -1 | 0 | 1 }> = {
  FRONT: { label: 'Straight', prompt: 'Look straight at the camera', help: 'Keep the face inside the oval and blink once.', challenge: 'BLINK', turn: 0 },
  LEFT_30: { label: 'Left', prompt: 'Turn your head a little to the left', help: 'A small turn is enough. Keep the face inside the oval.', challenge: 'TURN_LEFT', turn: -1 },
  RIGHT_30: { label: 'Right', prompt: 'Turn your head a little to the right', help: 'A small turn is enough. Keep the face inside the oval.', challenge: 'TURN_RIGHT', turn: 1 },
  UP_15: { label: 'Chin down', prompt: 'Tilt your chin down a little', help: 'Look just below the camera.', challenge: 'NOD', turn: 0 },
  VARIED_LIGHT: { label: 'Smile', prompt: 'Smile, in brighter light', help: 'Move closer to a window or a lamp.', challenge: 'SMILE', turn: 0 },
}

export async function openCamera(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('No camera API'), { name: 'NoMediaDevices' })
  }
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
}

export interface Frame { dataUrl: string; base64: string; brightness: number }

/**
 * One photo from the live camera, prepared the way the phone app prepares its
 * enrollment photo (utils/faceCapture.ts, app/face-enroll.tsx): centre-cropped
 * to 3:4, at most 640 px wide, JPEG, and mirrored — the phone enrolls with a
 * mirrored front camera, and the server's turn-left / turn-right check reads
 * the photo that way. It is also exactly what the person saw in the preview.
 */
export function captureFrame(video: HTMLVideoElement): Frame | null {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return null
  const aspect = 3 / 4
  const cw = vw / vh > aspect ? Math.round(vh * aspect) : vw
  const ch = vw / vh > aspect ? vh : Math.round(vw / aspect)
  const outW = Math.min(640, cw), outH = Math.round(outW / aspect)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.translate(outW, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, Math.floor((vw - cw) / 2), Math.floor((vh - ch) / 2), cw, ch, 0, 0, outW, outH)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), brightness: centreBrightness(ctx, outW, outH) }
}

/** Average brightness (0–255) of the middle of the photo, where the face should be. */
function centreBrightness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const d = ctx.getImageData(Math.round(w * 0.25), Math.round(h * 0.2), Math.round(w * 0.5), Math.round(h * 0.55)).data
  let sum = 0, n = 0
  for (let i = 0; i < d.length; i += 16) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++ }
  return n ? sum / n : 0
}

/** Only clear cases: the server's quality check still has the final say. */
export function lightProblem(brightness: number): 'dark' | 'bright' | null {
  return brightness < 45 ? 'dark' : brightness > 225 ? 'bright' : null
}

export const LIGHT_TEXT = {
  dark: 'This photo looks too dark. Face a window or a lamp, then take it again.',
  bright: 'This photo looks too bright. Move out of direct light, then take it again.',
}

// ── plain-English errors ─────────────────────────────────────────────────────

/** Why the camera didn't open (getUserMedia's error names). */
export function cameraErrorText(err: unknown): string {
  switch ((err as { name?: string } | null)?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then try again.'
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError':
      return 'No camera was found. Connect a camera, or enroll from the mobile app.'
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return 'The camera is busy or not working. Close other apps that use it, then try again.'
    case 'NoMediaDevices':
      return 'This browser can’t open a camera here. Use a recent Chrome, Edge, Firefox or Safari.'
    default:
      return 'The camera couldn’t start. Try again.'
  }
}

/** Why the server didn't accept one photo (EnrollmentSampleResponse.rejectionCode). */
export function sampleRejectText(r: Pick<SampleResponse, 'rejectionCode' | 'rejectionReason'>): string {
  switch (r.rejectionCode) {
    case 'FAIL_NO_FACE': return 'No face found in this photo. Keep the face inside the oval and take it again.'
    case 'FAIL_MULTIPLE_FACES': return 'More than one face is in this photo. Make sure only one person is in the frame.'
    case 'FAIL_LOW_QUALITY': return 'This photo is too dark or blurry. Face a light, hold still and take it again.'
    case 'FAIL_LIVENESS': return 'We couldn’t confirm a live face. Look at the camera, blink, and take it again.'
    case 'FAIL_OTHER': return 'This photo couldn’t be checked. Take it again.'
    default: return 'This photo wasn’t accepted. Take it again.'
  }
}

/** The machine code at the front of a face error ("FACE_LOCKED:…"), if any. */
export function faceErrorCode(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : ''
  const m = /^([A-Z][A-Z0-9_]{3,}):/.exec(msg)
  return m ? m[1] : null
}

export const WORKER_DOWN_TEXT = 'The face check service isn’t available right now. Your photos are kept here. Try again in a few minutes.'

/** A failed request, in plain English. `self`: the person is enrolling their own face. */
export function faceErrorText(err: unknown, self: boolean): string {
  const code = faceErrorCode(err)
  switch (code) {
    case 'FACE_LOCKED': return self
      ? 'Face check is still locked after several failed tries, so your face can’t be re-enrolled yet. Try again later, or ask HR to unlock it.'
      : 'Face check is locked for this person after several failed tries. Try again in a moment.'
    case 'FACE_DISABLED': return 'Face punch-in is turned off for this workspace.'
    case 'FACE_WORKER_UNAVAILABLE': case 'FACE_WORKER_BAD_RESPONSE': case 'FACE_WORKER_BAD_EMBEDDING':
      return WORKER_DOWN_TEXT
    case 'FACE_NO_LOGIN': return 'This person can’t sign in yet, so there is no face to enroll. Invite them first.'
    case 'FACE_ENROLLMENT_NOT_FOUND': return 'This enrollment timed out. Send the photos again.'
    case 'FACE_SAMPLES_INCOMPLETE': return 'Some photos haven’t been accepted yet. Retake them and send again.'
  }
  const status = err instanceof HttpError ? err.status : undefined
  if (status === 401) return 'Your session has ended. Sign in again.'
  if (status === 403) return self ? 'Your role doesn’t allow face enrollment. Ask your admin.' : 'You don’t have permission to enroll other people’s faces.'
  if (status === 404) return 'Face enrollment isn’t available on this server yet.'
  if (status === 413) return 'That photo was too large. Take it again.'
  if (status === 429) return 'Too many tries. Wait a minute, then try again.'
  if (status && status >= 500) return WORKER_DOWN_TEXT
  if (status === undefined && err instanceof TypeError) return 'Can’t reach the server. Check your connection and try again.'
  // Any other sentence the server sent, without its code; else a plain fallback.
  const msg = err instanceof Error ? (code ? err.message.slice(code.length + 1) : err.message).trim() : ''
  return msg && !/^Request failed/.test(msg) ? msg : 'Something went wrong. Try again.'
}

// ── status, in words ─────────────────────────────────────────────────────────

export interface FaceSummary { tone: PillTone; label: string; detail: string; enrolled: boolean; locked: boolean; canEnroll: boolean }

/**
 * How a status reads on a profile. `self`: the person is looking at their own.
 * A locked face check can be re-enrolled by its owner once the lock's time is
 * up (the server clears the lock when the new enrollment starts, as on the
 * phone); before that, or when only HR can clear it, it can't. HR's re-enroll
 * unlocks it any time.
 */
export function describeFace(s: FaceStatus, self: boolean, now = Date.now()): FaceSummary {
  const on = s.enrolledAt ? format(new Date(s.enrolledAt), 'd MMM yyyy') : null
  if (s.hasLogin === false) return { tone: 'gray', label: 'No sign-in yet', detail: 'They can’t sign in yet, so there is no face to enroll. Invite them first.', enrolled: false, locked: false, canEnroll: false }
  switch (s.status) {
    case 'ACTIVE': return { tone: 'ok', label: 'Enrolled', detail: on ? `Enrolled on ${on}` : 'Enrolled', enrolled: true, locked: false, canEnroll: true }
    case 'LOCKED': {
      if (!self) return { tone: 'red', label: 'Locked', detail: 'Locked after several failed face checks. Re-enrolling unlocks it.', enrolled: true, locked: true, canEnroll: true }
      const until = s.unlocksAt ? new Date(s.unlocksAt) : null
      if (until && until.getTime() <= now) {
        return { tone: 'warn', label: 'Locked', detail: 'Face check was locked after several failed tries. Re-enroll your face to use face punch-in again.', enrolled: true, locked: true, canEnroll: true }
      }
      const when = until ? format(until, new Date(now).toDateString() === until.toDateString() ? 'h:mm a' : 'd MMM, h:mm a') : null
      return {
        tone: 'red', label: 'Locked', enrolled: true, locked: true, canEnroll: false,
        detail: when ? `Locked after several failed face checks. You can re-enroll from ${when}, or ask HR to unlock it sooner.` : 'Locked after several failed face checks. Ask HR to unlock it.',
      }
    }
    case 'NEEDS_REENROLLMENT': return { tone: 'warn', label: 'Needs re-enrolling', detail: 'The face on record has to be enrolled again.', enrolled: true, locked: false, canEnroll: true }
    case 'REVOKED': return { tone: 'gray', label: 'Not enrolled', detail: 'The earlier face was reset. Enroll again to use face punch-in.', enrolled: false, locked: false, canEnroll: true }
    default: return s.samplesCaptured > 0
      ? { tone: 'warn', label: 'Not finished', detail: 'An enrollment was started but not finished.', enrolled: false, locked: false, canEnroll: true }
      : { tone: 'gray', label: 'Not enrolled', detail: self ? 'Enroll your face to punch in with it.' : 'No face enrolled yet.', enrolled: false, locked: false, canEnroll: true }
  }
}
