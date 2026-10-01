// The web punch dialog: check in or out from the browser with a face scan (client decision, 1 Oct),
// in the redesign's Dialog. One shared component: My Attendance uses it, and so does Home (P-HOME).
//
//   <WebPunchDialog open={open} onClose={…} mode="in" onDone={(record) => …} />
//
// Layout (NextWave reference, redesign style): the live camera with a face guide on the left; on the
// right the steps (camera, location), what went wrong if anything did, and one full-width button.
// While the check runs the button turns into a spinner and the dialog can't be closed; when the punch
// is saved the dialog closes and a toast says so. On a phone the two halves stack.
//
// The checks are the phone's (see webPunch.ts): the zone check before the camera matters, the face
// check on the server before anything is recorded. No face enrolled yet: when the person may enrol
// their own face (attendance.face.enroll.self) the dialog offers it first (the web enrolment, the
// same one the profile uses) and comes back here when it's done; otherwise it says who can enrol it.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, useToast } from '@/design/kit/overlays'
import { Button } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { httpStatusOf } from '@/core/api/featureNotReady'
import type { AttendanceDto } from '../../api/useAttendance'
import { FaceEnrollDrawer } from '../face/FaceEnrollDrawer'
import { useCanSelfEnrollFace } from '../face/FaceEnrollment'
import { cameraErrorText, captureFrame, openCamera, useFaceStatus } from '../face/faceEnroll'
import { clockIst, geoCheck, locate, locationErrorText, punch, punchRefusal, type PunchMode, type Spot } from './webPunch'
import { refreshAfterPunch } from './useMyDay'
import './webPunch.css'

export interface WebPunchDialogProps {
  open: boolean
  onClose: () => void
  mode: PunchMode
  /** Called with the saved record once the punch is recorded (the dialog then closes itself). */
  onDone?: (record: AttendanceDto) => void
}

export function WebPunchDialog(props: WebPunchDialogProps) {
  if (!props.open) return null
  return <OpenWebPunch {...props} />
}

type Line = { state: 'wait' | 'ok' | 'bad'; text: string }
const SELF = { kind: 'self' } as const

function OpenWebPunch({ onClose, mode, onDone }: WebPunchDialogProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const canEnroll = useCanSelfEnrollFace()
  const status = useFaceStatus(SELF, true)
  const [enrolling, setEnrolling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ text: string; stop: boolean } | null>(null)
  const [needsEnrol, setNeedsEnrol] = useState(false)
  const verb = mode === 'in' ? 'Check in' : 'Check out'

  // ── the face on record ──
  const face = status.data
  const lockedUntil = face?.status === 'LOCKED' && face.unlocksAt ? new Date(face.unlocksAt) : null
  const locked = face?.status === 'LOCKED' && (!lockedUntil || lockedUntil.getTime() > Date.now())
  const enrolled = face?.status === 'ACTIVE' || (face?.status === 'LOCKED' && !locked)
  const notEnrolled = needsEnrol || (!!face && !enrolled && !locked)
  const faceForbidden = status.isError && httpStatusOf(status.error) === 403
  const ready = !!face && enrolled && !needsEnrol

  // ── location and the zone ──
  const [spot, setSpot] = useState<Spot | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [where, setWhere] = useState<Line>({ state: 'wait', text: 'Finding your location…' })
  const [geoTry, setGeoTry] = useState(0)
  useEffect(() => {
    let live = true
    setWhere({ state: 'wait', text: 'Finding your location…' })
    locate().then(async (s) => {
      if (!live) return
      setSpot(s)
      setWhere({ state: 'wait', text: 'Checking your work area…' })
      try {
        const g = await geoCheck(s)
        if (!live) return
        setPlace(g.branchName || null)
        if (g.withinFence) setWhere({ state: 'ok', text: g.branchName ? `Location found · ${g.branchName}` : 'Location found' })
        else setWhere({ state: 'bad', text: `You’re outside your work area${g.branchName ? ` (${g.branchName})` : ''}. ${g.message || ''} Move inside it to ${verb.toLowerCase()}.`.replace(/\s+/g, ' ').trim() })
      } catch (e) {
        if (!live) return
        // A server without the pre-punch check still applies the zone when the punch arrives.
        if (httpStatusOf(e) === 403) setWhere({ state: 'bad', text: `Your role can’t ${verb.toLowerCase()} from the web. Ask your admin.` })
        else setWhere({ state: 'ok', text: 'Location found' })
      }
    }).catch((e) => { if (live) setWhere({ state: 'bad', text: locationErrorText(e) }) })
    return () => { live = false }
  }, [geoTry, verb])
  const outside = where.state === 'bad'

  // ── camera ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cam, setCam] = useState<Line>({ state: 'wait', text: 'Starting the camera…' })
  const [camTry, setCamTry] = useState(0)
  const wantCamera = ready && !enrolling && !outside
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    if (!wantCamera) { stopCamera(); return }
    let live = true
    setCam({ state: 'wait', text: 'Starting the camera…' })
    openCamera().then((stream) => {
      if (!live) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setCam({ state: 'bad', text: 'The camera stopped. Check that it’s connected, then try again.' }))
      const v = videoRef.current
      if (v) { v.srcObject = stream; void v.play().catch(() => {}) }
      setCam({ state: 'ok', text: 'Camera ready. Look straight at it.' })
    }).catch((e) => { if (live) setCam({ state: 'bad', text: cameraErrorText(e) }) })
    return () => { live = false; stopCamera() }
  }, [wantCamera, camTry, stopCamera])

  const close = () => { if (!busy) { stopCamera(); onClose() } }

  const go = async () => {
    if (busy || !spot) return
    const v = videoRef.current
    const frame = v ? captureFrame(v) : null
    if (!frame) { setProblem({ text: 'The camera isn’t ready yet. Wait a moment, then try again.', stop: false }); return }
    setBusy(true); setProblem(null)
    try {
      const rec = await punch(mode, spot, frame.base64, place)
      stopCamera()
      refreshAfterPunch(qc)
      const at = clockIst(mode === 'in' ? rec?.checkInTime : rec?.checkOutTime)
      toast.success(`${mode === 'in' ? 'Checked in' : 'Checked out'}${at ? ` at ${at}` : ''}. Your face was verified.`)
      onDone?.(rec)
      onClose()
    } catch (e) {
      const r = punchRefusal(e, mode)
      if (r.kind === 'enroll') { setNeedsEnrol(true); setProblem(null); void status.refetch() }
      else setProblem({ text: r.text, stop: r.kind === 'stop' })
      // Already punched, switched off…: the page behind should show what's true now.
      if (r.kind === 'stop') refreshAfterPunch(qc)
    } finally {
      setBusy(false)
    }
  }

  // ── enrolment, in place of this dialog while it's open ──
  if (enrolling) {
    return (
      <FaceEnrollDrawer
        target={SELF}
        reenroll={face?.status === 'NEEDS_REENROLLMENT' || face?.status === 'LOCKED'}
        enrolledAt={face?.enrolledAt}
        onClose={() => setEnrolling(false)}
        onEnrolled={() => { setNeedsEnrol(false); setEnrolling(false); void status.refetch() }}
      />
    )
  }

  // ── what the right-hand side says ──
  let side: JSX.Element
  if (status.isLoading) {
    side = <p className="uwp-line" data-state="wait" role="status"><Dot state="wait" />Checking your face enrolment…</p>
  } else if (faceForbidden) {
    side = <Callout tone="bad">Your access doesn’t include the face check, so you can’t {verb.toLowerCase()} from the web. Ask your admin.</Callout>
  } else if (status.isError) {
    side = (
      <>
        <Callout tone="bad">Couldn’t load your face enrolment.</Callout>
        <Button variant="secondary" block onClick={() => void status.refetch()}>Try again</Button>
      </>
    )
  } else if (locked) {
    side = (
      <Callout tone="bad">
        The face check is locked after several failed tries.{' '}
        {lockedUntil ? `It unlocks at ${clockIst(lockedUntil.toISOString())}, or HR can reset it sooner.` : 'Ask HR to reset it.'}
      </Callout>
    )
  } else if (notEnrolled) {
    side = canEnroll ? (
      <>
        <p className="uwp-lead">Your face isn’t enrolled yet. Enrol it once with this camera (three photos, about a minute), then {verb.toLowerCase()}.</p>
        <Button variant="primary" size={44} block icon="scanFace" onClick={() => { stopCamera(); setEnrolling(true) }}>Enrol my face</Button>
      </>
    ) : (
      <Callout tone="warn">
        Your face isn’t enrolled yet, and your role can’t enrol it yourself. Ask HR to enrol it from your employee profile
        (anyone who can reset face enrolment can do it), then {verb.toLowerCase()} here.
      </Callout>
    )
  } else {
    side = (
      <>
        <ul className="uwp-steps" aria-label="Before you continue">
          <li className="uwp-line" data-state={cam.state}><Dot state={cam.state} />{cam.text}</li>
          <li className="uwp-line" data-state={where.state}><Dot state={where.state} />{where.text}</li>
        </ul>
        {problem && <Callout tone={problem.stop ? 'warn' : 'bad'}>{problem.text}</Callout>}
        <Button
          variant="primary" size={44} block loading={busy}
          disabled={busy || cam.state !== 'ok' || where.state !== 'ok' || !spot || !!problem?.stop}
          onClick={() => void go()}
          aria-label={busy ? 'Verifying your face' : `Verify and ${verb.toLowerCase()}`}
        >
          {`Verify and ${verb.toLowerCase()}`}
        </Button>
        {(cam.state === 'bad' || where.state === 'bad') && !busy && (
          <div className="uwp-retry">
            {cam.state === 'bad' && <Button variant="ghost" size={32} onClick={() => setCamTry((n) => n + 1)}>Try the camera again</Button>}
            {where.state === 'bad' && <Button variant="ghost" size={32} onClick={() => setGeoTry((n) => n + 1)}>Check my location again</Button>}
          </div>
        )}
        <p className="uwp-fine">The photo is used for this check only and isn’t saved.</p>
      </>
    )
  }

  const showVideo = wantCamera
  return (
    <Dialog
      open
      onClose={close}
      busy={busy}
      width={760}
      icon="shield"
      title={`${verb} with your face`}
      sub="We match your face with the one you enrolled, and note where you are, as the mobile app does."
    >
      <div className="uwp" data-busy={busy ? '' : undefined}>
        <div className="uwp-cam" aria-label="Camera preview">
          {showVideo ? (
            <>
              <video ref={videoRef} className="uwp-video" autoPlay playsInline muted aria-hidden="true" />
              <svg className="uwp-guide" viewBox="0 0 300 400" aria-hidden="true">
                <ellipse cx="150" cy="190" rx="92" ry="122" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="10 8" />
                <path d="M22 60V30a8 8 0 0 1 8-8h30M240 22h30a8 8 0 0 1 8 8v30M278 340v30a8 8 0 0 1-8 8h-30M60 378H30a8 8 0 0 1-8-8v-30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {busy && <span className="uwp-scan" aria-hidden="true" />}
            </>
          ) : (
            <span className="uwp-cam-idle" aria-hidden="true">{dashIcon('scanFace', 44)}</span>
          )}
        </div>
        <div className="uwp-side">{side}</div>
      </div>
    </Dialog>
  )
}

function Dot({ state }: { state: Line['state'] }) {
  return (
    <span className="uwp-dot" data-state={state} aria-hidden="true">
      {state === 'ok' ? dashIcon('check', 12) : state === 'bad' ? dashIcon('x', 12) : <span className="uwp-spin" />}
    </span>
  )
}

function Callout({ tone, children }: { tone: 'bad' | 'warn'; children: ReactNode }) {
  return <p className="uwp-callout" data-tone={tone} role="alert">{children}</p>
}
