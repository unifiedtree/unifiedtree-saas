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
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, useToast } from '@/design/kit/overlays'
import { Button } from '@/design/kit/display'
import { httpStatusOf } from '@/core/api/featureNotReady'
import type { AttendanceDto } from '../../api/useAttendance'
import { FaceEnrollDrawer } from '../face/FaceEnrollDrawer'
import { useCanSelfEnrollFace } from '../face/FaceEnrollment'
import { useFaceStatus } from '../face/faceEnroll'
import { clockIst, punch, punchRefusal, type PunchMode } from './webPunch'
import { refreshAfterPunch } from './useMyDay'
import { useCamera } from './useCamera'
import { useSpot } from './useSpot'
import { CameraBox, PunchNote, Step, StepDot } from './CameraParts'

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
  const verb = mode === 'in' ? 'check in' : 'check out'
  const Verb = mode === 'in' ? 'Check in' : 'Check out'

  // ── the face on record ──
  const face = status.data
  const lockedUntil = face?.status === 'LOCKED' && face.unlocksAt ? new Date(face.unlocksAt) : null
  const locked = face?.status === 'LOCKED' && (!lockedUntil || lockedUntil.getTime() > Date.now())
  const enrolled = face?.status === 'ACTIVE' || (face?.status === 'LOCKED' && !locked)
  const notEnrolled = needsEnrol || (!!face && !enrolled && !locked)
  const faceForbidden = status.isError && httpStatusOf(status.error) === 403
  const ready = !!face && enrolled && !needsEnrol

  const where = useSpot(true, true, verb)
  const outside = where.line.state === 'bad'
  const showCamera = ready && !enrolling && !outside
  const cam = useCamera(showCamera)

  const close = () => { if (!busy) { cam.stop(); onClose() } }

  const go = async () => {
    if (busy || !where.spot) return
    const frame = cam.capture()
    if (!frame) { setProblem({ text: 'The camera isn’t ready yet. Wait a moment, then try again.', stop: false }); return }
    setBusy(true); setProblem(null)
    try {
      const rec = await punch(mode, where.spot, frame.base64, where.place)
      cam.stop()
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
        wasReset={face?.status === 'REVOKED'}
        enrolledAt={face?.enrolledAt}
        onClose={() => setEnrolling(false)}
        onEnrolled={() => { setNeedsEnrol(false); setEnrolling(false); void status.refetch() }}
      />
    )
  }

  // ── what the right-hand side says ──
  let side: JSX.Element
  if (status.isLoading) {
    side = <p className="uwp-line" data-state="wait" role="status"><StepDot state="wait" />Checking your face enrolment…</p>
  } else if (faceForbidden) {
    side = <PunchNote tone="bad">Your access doesn’t include the face check, so you can’t {verb} from the web. Ask your admin.</PunchNote>
  } else if (status.isError) {
    side = (
      <>
        <PunchNote tone="bad">Couldn’t load your face enrolment.</PunchNote>
        <Button variant="secondary" block onClick={() => void status.refetch()}>Try again</Button>
      </>
    )
  } else if (locked) {
    side = (
      <PunchNote tone="bad">
        The face check is locked after several failed tries.{' '}
        {lockedUntil ? `It unlocks at ${clockIst(lockedUntil.toISOString())}, or HR can reset it sooner.` : 'Ask HR to reset it.'}
      </PunchNote>
    )
  } else if (notEnrolled) {
    side = canEnroll ? (
      <>
        <p className="uwp-lead">Your face isn’t enrolled yet. Enrol it once with this camera (three photos, about a minute), then {verb}.</p>
        <Button variant="primary" size={44} block icon="scanFace" onClick={() => { cam.stop(); setEnrolling(true) }}>Enrol my face</Button>
      </>
    ) : (
      <PunchNote tone="warn">
        Your face isn’t enrolled yet, and your role can’t enrol it yourself. Ask HR to enrol it from your employee profile
        (anyone who can reset face enrolment can do it), then {verb} here.
      </PunchNote>
    )
  } else {
    side = (
      <>
        <ul className="uwp-steps" aria-label="Before you continue">
          {!outside && <Step line={cam.line} />}
          <Step line={where.line} />
        </ul>
        {problem && <PunchNote tone={problem.stop ? 'warn' : 'bad'}>{problem.text}</PunchNote>}
        <Button
          variant="primary" size={44} block loading={busy}
          disabled={busy || cam.line.state !== 'ok' || where.line.state !== 'ok' || !where.spot || !!problem?.stop}
          onClick={() => void go()}
        >
          {`Verify and ${verb}`}
        </Button>
        {(cam.line.state === 'bad' || outside) && !busy && (
          <div className="uwp-retry">
            {cam.line.state === 'bad' && !outside && <Button variant="ghost" size={32} onClick={cam.retry}>Try the camera again</Button>}
            {outside && <Button variant="ghost" size={32} onClick={where.retry}>Check my location again</Button>}
          </div>
        )}
        <p className="uwp-fine">The photo is used for this check only and isn’t saved.</p>
      </>
    )
  }

  return (
    <Dialog
      open
      onClose={close}
      busy={busy}
      width={760}
      icon="shield"
      title={`${Verb} with your face`}
      sub="We match your face with the one you enrolled, and note where you are, as the mobile app does."
    >
      <div className="uwp" data-busy={busy ? '' : undefined}>
        <CameraBox videoRef={cam.videoRef} on={showCamera} scanning={busy} />
        <div className="uwp-side">{side}</div>
      </div>
    </Dialog>
  )
}
