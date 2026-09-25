// Face enrollment with the web camera: yourself (from your profile) or, for
// HR / admin, the employee whose record is open. Four steps in one drawer:
//
//   intro   what will happen, tips, and (re-enrolling) what gets replaced
//   camera  live preview with an oval guide; one photo per angle, each shown
//           back with Retake / Use photo, and a plain light check
//   review  the photos side by side, the consent line, Save
//   done
//
// Nothing leaves the browser until Save (after consent). Save starts the
// enrollment on the server — which is also the moment an earlier face stops
// working — and sends each photo; the server's face check says why a photo is
// refused (no face, more than one face, too dark or blurry) and only that
// photo is retaken. Photos the server accepted are not sent again.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { format } from 'date-fns'
import { HrButton, HrDrawer } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import {
  ANGLE, DEFAULT_SEQUENCE, LIGHT_TEXT, captureFrame, cameraErrorText, faceEnrollApi, faceErrorCode, faceErrorText,
  faceStatusKey, lightProblem, openCamera, sampleRejectText, type CaptureAngle, type FaceTarget,
} from './faceEnroll'

type Step = 'intro' | 'camera' | 'review' | 'done'
interface Shot { dataUrl: string; base64: string; light: 'dark' | 'bright' | null; state: 'new' | 'accepted' | 'rejected'; error?: string }
type Shots = Partial<Record<CaptureAngle, Shot>>

const INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', GREEN = '#059669', DEEP = '#047857'
const note = (tone: 'amber' | 'red' | 'green'): CSSProperties => ({
  margin: 0, padding: '10px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
  ...(tone === 'amber' ? { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }
    : tone === 'red' ? { background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239' }
      : { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46' }),
})

export function FaceEnrollDrawer({ target, reenroll, enrolledAt, onClose, onEnrolled }: {
  target: FaceTarget
  /** A face is on record now; this replaces it. */
  reenroll: boolean
  enrolledAt?: string | null
  onClose: () => void
  onEnrolled?: () => void
}) {
  const qc = useQueryClient()
  const self = target.kind === 'self'
  const name = target.kind === 'employee' ? target.name : ''
  const first = name.split(' ')[0] || name
  const [step, setStep] = useState<Step>('intro')
  const [angles, setAngles] = useState<CaptureAngle[]>(DEFAULT_SEQUENCE)
  const [current, setCurrent] = useState<CaptureAngle>(DEFAULT_SEQUENCE[0])
  const [shots, setShotsState] = useState<Shots>({})
  const shotsRef = useRef<Shots>({})
  const setShots = (next: Shots) => { shotsRef.current = next; setShotsState(next) }
  const [pending, setPending] = useState<Shot | null>(null)
  const [backToReview, setBackToReview] = useState(false)
  const [camReady, setCamReady] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [camTry, setCamTry] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const enrollmentId = useRef<string | null>(null)
  const [started, setStarted] = useState(false)

  // ── camera ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    if (step !== 'camera') { stopCamera(); return }
    let cancelled = false
    openCamera().then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setCamReady(false)
        setCamError('The camera stopped. Check that it’s connected, then try again.')
      })
      const v = videoRef.current
      if (v) { v.srcObject = stream; void v.play().catch(() => {}) }
    }).catch((e) => { if (!cancelled) setCamError(cameraErrorText(e)) })
    return () => { cancelled = true; stopCamera(); setCamReady(false) }
  }, [step, camTry, stopCamera])

  const firstMissing = (list: CaptureAngle[], s: Shots) => list.find((a) => !s[a])
  const openCameraStep = (angle: CaptureAngle, returnToReview: boolean) => {
    setCurrent(angle); setBackToReview(returnToReview); setPending(null); setHint(null); setCamError(null); setStep('camera')
  }

  const take = () => {
    const v = videoRef.current
    const f = v ? captureFrame(v) : null
    if (!f) { setHint('The camera isn’t ready yet. Wait a moment, then take the photo.'); return }
    setHint(null)
    setPending({ dataUrl: f.dataUrl, base64: f.base64, light: lightProblem(f.brightness), state: 'new' })
  }
  const keepPhoto = () => {
    if (!pending) return
    const next = { ...shotsRef.current, [current]: { ...pending, state: 'new' as const, error: undefined } }
    setShots(next)
    setPending(null)
    const missing = firstMissing(angles, next)
    if (backToReview || !missing) { setBackToReview(false); setStep('review') } else setCurrent(missing)
  }

  // ── save ──
  const allTaken = angles.every((a) => shots[a] && shots[a]!.state !== 'rejected')
  const save = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      let seq = angles
      if (!enrollmentId.current) {
        setProgress('Starting…')
        const s = await faceEnrollApi.start(target)
        enrollmentId.current = s.enrollmentId
        setStarted(true)
        // A fresh enrollment holds no photos yet.
        const fresh: Shots = {}
        for (const [a, sh] of Object.entries(shotsRef.current) as [CaptureAngle, Shot][]) fresh[a] = { ...sh, state: 'new', error: undefined }
        setShots(fresh)
        if (s.captureSequence?.length) { seq = s.captureSequence; setAngles(seq) }
      }
      const missing = firstMissing(seq, shotsRef.current)
      if (missing) { openCameraStep(missing, true); setHint('One more photo is needed.'); return }
      let refused = 0
      for (const [i, a] of seq.entries()) {
        const shot = shotsRef.current[a]
        if (!shot || shot.state === 'accepted') continue
        setProgress(`Checking photo ${i + 1} of ${seq.length}…`)
        let r
        try {
          r = await faceEnrollApi.sample(target, { enrollmentId: enrollmentId.current!, captureAngle: a, imageBase64: shot.base64, challengePerformed: ANGLE[a].challenge })
        } catch (e) {
          // The server lost this enrollment: the next Save starts a new one.
          if (faceErrorCode(e) === 'FACE_ENROLLMENT_NOT_FOUND') enrollmentId.current = null
          throw e
        }
        const ok = r.accepted || r.rejectionCode === 'DUPLICATE_ANGLE'
        setShots({ ...shotsRef.current, [a]: { ...shot, state: ok ? 'accepted' : 'rejected', error: ok ? undefined : sampleRejectText(r) } })
        if (!ok) refused++
      }
      if (refused) return
      setProgress('Saving…')
      await faceEnrollApi.complete(target)
      setStep('done')
      void qc.invalidateQueries({ queryKey: faceStatusKey(target) })
      onEnrolled?.()
    } catch (e) {
      setError(faceErrorText(e, self))
    } finally {
      setBusy(false); setProgress('')
    }
  }

  // Leaving after Save started but before it finished leaves no working face (on a re-enroll, the old one is gone).
  const close = () => {
    if (busy) return
    if (started && step !== 'done' && !confirmLeave) { setConfirmLeave(true); return }
    stopCamera(); onClose()
  }

  // ── view ──
  const title = self ? (reenroll ? 'Re-enroll your face' : 'Enroll your face') : (reenroll ? `Re-enroll ${name}’s face` : `Enroll ${name}’s face`)
  const idx = angles.indexOf(current)
  const a = ANGLE[current]
  const refusedShots = angles.filter((x) => shots[x]?.state === 'rejected')

  let body: ReactNode, footer: ReactNode
  if (confirmLeave) {
    body = (
      <p style={note('amber')}>
        {reenroll
          ? `Leave without finishing? The earlier face record has already been replaced, so face punch-in won’t work for ${self ? 'you' : first} until this is finished.`
          : `Leave without finishing? ${self ? 'Your' : `${first}’s`} face isn’t saved until every photo is accepted.`}
      </p>
    )
    footer = <>
      <HrButton variant="ghost" onClick={() => { stopCamera(); onClose() }}>Leave anyway</HrButton>
      <HrButton onClick={() => setConfirmLeave(false)}>Keep going</HrButton>
    </>
  } else if (step === 'intro') {
    body = (
      <div style={{ display: 'grid', gap: 18 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#334155' }}>
          We’ll take {angles.length} photos of {self ? 'your' : `${first}’s`} face: looking straight at the camera, then turning a little to the left and to the right. It takes about a minute.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {angles.map((x, i) => (
            <div key={x} style={{ flex: '1 1 0', minWidth: 0, display: 'grid', justifyItems: 'center', gap: 6, padding: '12px 6px 10px', border: `1px solid ${LINE}`, borderRadius: 14, background: '#f8fafc' }}>
              <PoseFace turn={ANGLE[x].turn} size={46} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{i + 1} · {ANGLE[x].label}</span>
            </div>
          ))}
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8, fontSize: 13.5, color: '#334155' }}>
          {(self
            ? ['Good, even light on your face. Face a window or a lamp.', 'Only you in the frame.', 'No sunglasses, cap or mask.']
            : [`${first} sits in front of this computer’s camera, in good, even light.`, `Only ${first} in the frame.`, 'No sunglasses, cap or mask.']
          ).map((t) => (
            <li key={t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 1, color: GREEN }}>{dashIcon('checkCircle', 16)}</span>{t}
            </li>
          ))}
        </ul>
        {reenroll && (
          <p style={note('amber')}>
            This replaces the face enrolled{enrolledAt ? ` on ${format(new Date(enrolledAt), 'd MMM yyyy')}` : ''}. The earlier one stops working once the new photos are sent.
          </p>
        )}
      </div>
    )
    footer = <>
      <HrButton variant="ghost" onClick={close}>Cancel</HrButton>
      <HrButton onClick={() => openCameraStep(firstMissing(angles, shotsRef.current) ?? angles[0], false)}>{<Camera size={15} />} Open camera</HrButton>
    </>
  } else if (step === 'camera') {
    body = (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em', color: DEEP, textTransform: 'uppercase' }}>Photo {idx + 1} of {angles.length}</span>
          <span style={{ fontSize: 12.5, color: MUTED }}>{a.label}</span>
        </div>
        <div data-testid="face-camera" style={{ position: 'relative', width: '100%', maxWidth: 360, margin: '0 auto', aspectRatio: '3 / 4', borderRadius: 18, overflow: 'hidden', background: INK }}>
          <video
            ref={videoRef} autoPlay playsInline muted aria-label="Camera preview"
            onLoadedData={() => setCamReady(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: pending || camError ? 'none' : 'block' }}
          />
          {pending && <img src={pending.dataUrl} alt={`Photo ${idx + 1}: ${a.label}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          {!pending && camReady && !camError && <Guide turn={a.turn} prompt={a.prompt} />}
          {!camReady && !camError && (
            <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cbd5e1', fontSize: 13.5 }}>Starting the camera…</div>
          )}
          {camError && (
            <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 12, padding: 24, textAlign: 'center', background: '#f8fafc' }}>
              <span aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: '#fff1f2', color: '#be123c' }}>{<Camera size={24} />}</span>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: INK, maxWidth: 280 }}>{camError}</p>
              <HrButton size="sm" variant="ghost" onClick={() => { setCamError(null); setCamTry((n) => n + 1) }}>Try again</HrButton>
            </div>
          )}
        </div>
        {!camError && (pending
          ? (pending.light ? <p role="alert" style={note('amber')}>{LIGHT_TEXT[pending.light]}</p>
            : <p style={{ margin: 0, fontSize: 13.5, color: MUTED, textAlign: 'center' }}>Is the whole face clear and inside the oval?</p>)
          : <p style={{ margin: 0, fontSize: 13.5, color: MUTED, textAlign: 'center' }}>{a.help}</p>)}
        {hint && <p role="status" style={note('amber')}>{hint}</p>}
        <Progress angles={angles} shots={shots} current={current} />
      </div>
    )
    footer = pending ? <>
      {pending.light
        ? <><HrButton variant="ghost" onClick={keepPhoto}>Use anyway</HrButton><HrButton onClick={() => setPending(null)}>Retake</HrButton></>
        : <><HrButton variant="ghost" onClick={() => setPending(null)}>Retake</HrButton><HrButton onClick={keepPhoto}>Use photo</HrButton></>}
    </> : <>
      <HrButton variant="ghost" onClick={() => { setPending(null); setStep(backToReview ? 'review' : 'intro') }}>Back</HrButton>
      <HrButton onClick={take} disabled={!camReady || !!camError}>{<Camera size={15} />} Take photo</HrButton>
    </>
  } else if (step === 'review') {
    body = (
      <div style={{ display: 'grid', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#334155' }}>Check the photos. Retake any that are blurry, dark or cut off.</p>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${angles.length}, minmax(0, 1fr))`, gap: 10 }}>
          {angles.map((x, i) => {
            const s = shots[x]
            const border = s?.state === 'accepted' ? '#34d399' : s?.state === 'rejected' ? '#fb7185' : LINE
            return (
              <figure key={x} style={{ margin: 0, display: 'grid', gap: 6, minWidth: 0 }}>
                <div style={{ position: 'relative', aspectRatio: '3 / 4', borderRadius: 12, overflow: 'hidden', border: `2px solid ${border}`, background: '#f1f5f9' }}>
                  {s ? <img src={s.dataUrl} alt={`Photo ${i + 1}: ${ANGLE[x].label}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, color: MUTED }}>Not taken</span>}
                  {s?.state === 'accepted' && <span aria-hidden="true" style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: GREEN, color: '#fff' }}>{dashIcon('check', 13)}</span>}
                </div>
                <figcaption style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600, color: INK }}>{i + 1} · {ANGLE[x].label}</span>
                  <span style={{ color: s?.state === 'accepted' ? DEEP : s?.state === 'rejected' ? '#be123c' : MUTED, fontWeight: s?.state ? 600 : 400 }}>
                    {s?.state === 'accepted' ? 'Accepted' : s?.state === 'rejected' ? 'Not accepted' : s ? 'Ready' : '—'}
                  </span>
                  {s?.state !== 'accepted' && (
                    <button type="button" onClick={() => openCameraStep(x, true)} disabled={busy}
                      style={{ justifySelf: 'start', padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: DEEP, cursor: busy ? 'default' : 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                      {s ? 'Retake' : 'Take photo'}
                    </button>
                  )}
                </figcaption>
              </figure>
            )
          })}
        </div>
        {refusedShots.length > 0 && (
          <div role="alert" style={{ ...note('red'), display: 'grid', gap: 6 }}>
            {refusedShots.map((x) => <span key={x}><strong>Photo {angles.indexOf(x) + 1} ({ANGLE[x].label}):</strong> {shots[x]?.error}</span>)}
          </div>
        )}
        {error && <p role="alert" style={note('red')}>{error}</p>}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: `1px solid ${consent ? '#a7f3d0' : LINE}`, borderRadius: 12, background: consent ? '#f0fdf4' : '#f8fafc', cursor: 'pointer', fontSize: 14, lineHeight: 1.45, color: INK }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy}
            style={{ flex: '0 0 auto', width: 18, height: 18, marginTop: 1, accentColor: GREEN, cursor: 'pointer' }} />
          <span>{self ? 'I agree to my face being used to mark my attendance.' : `${name} agrees to their face being used to mark their attendance.`}</span>
        </label>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
          The photos aren’t stored. Only an encrypted face pattern made from them is kept, and it’s used only to check it’s {self ? 'you' : first} at face punch-in.
        </p>
        {progress && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: DEEP }}>{progress}</p>}
      </div>
    )
    footer = <>
      <HrButton variant="ghost" onClick={close} disabled={busy}>Cancel</HrButton>
      <HrButton onClick={() => void save()} disabled={busy || !consent || !allTaken}
        title={!consent ? 'Tick the consent box first' : !allTaken ? 'Retake the photos that weren’t accepted' : undefined}>
        {busy ? 'Checking…' : error || refusedShots.length ? 'Send again' : self ? 'Save my face' : 'Save face'}
      </HrButton>
    </>
  } else {
    body = (
      <div role="status" style={{ display: 'grid', justifyItems: 'center', gap: 12, padding: '36px 8px', textAlign: 'center' }}>
        <span aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 99, display: 'grid', placeItems: 'center', background: '#ecfdf5', color: GREEN, border: '1px solid #a7f3d0' }}>{dashIcon('check', 30)}</span>
        <h4 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontSize: 20, fontWeight: 700, color: INK }}>{reenroll ? 'Face re-enrolled' : 'Face enrolled'}</h4>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#334155', maxWidth: 340 }}>
          {self ? 'You can now punch in with your face.' : `${first} can now punch in with their face.`}
        </p>
      </div>
    )
    footer = <HrButton onClick={close}>Done</HrButton>
  }

  return (
    <HrDrawer title={title} onClose={close} footer={footer}>
      <div style={{ fontFamily: 'Inter,-apple-system,sans-serif', color: INK }}>{body}</div>
    </HrDrawer>
  )
}

/** The oval to keep the face in, the ask, and (for a turn) which way. The preview is mirrored, so left is on the left. */
function Guide({ turn, prompt }: { turn: -1 | 0 | 1; prompt: string }) {
  const cx = 150, cy = 188, rx = 92, ry = 122
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg viewBox="0 0 300 400" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <path fillRule="evenodd" fill="rgba(15,23,42,.5)" d={`M0,0H300V400H0Z M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0Z`} />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#34d399" strokeWidth="3" strokeDasharray="10 7" />
        {turn !== 0 && (
          <path d={turn < 0 ? 'M40,188 l18,-16 v10 h20 v12 h-20 v10z' : 'M260,188 l-18,-16 v10 h-20 v12 h20 v10z'} fill="#34d399" />
        )}
      </svg>
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'center' }}>
        <span style={{ padding: '6px 12px', borderRadius: 99, background: 'rgba(15,23,42,.72)', color: '#fff', fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.35 }}>{prompt}</span>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', justifyContent: 'center' }}>
        <span style={{ whiteSpace: 'nowrap', padding: '5px 10px', borderRadius: 99, background: 'rgba(15,23,42,.6)', color: '#e2e8f0', fontSize: 12 }}>Good light · one face only</span>
      </div>
    </div>
  )
}

/** Where you are: done, now, next. */
function Progress({ angles, shots, current }: { angles: CaptureAngle[]; shots: Shots; current: CaptureAngle }) {
  return (
    <ol aria-label="Photos" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
      {angles.map((x, i) => {
        const done = !!shots[x], now = x === current
        return (
          <li key={x} aria-current={now ? 'step' : undefined} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${now ? GREEN : done ? '#a7f3d0' : LINE}`, background: now ? '#ecfdf5' : done ? '#f0fdf4' : '#fff', color: now || done ? DEEP : MUTED,
          }}>
            {done && !now ? dashIcon('check', 12) : <span>{i + 1}</span>} {ANGLE[x].label}
          </li>
        )
      })}
    </ol>
  )
}

/** A simple face turned left, straight or right (as the person sees it in the mirrored preview). */
function PoseFace({ turn, size }: { turn: -1 | 0 | 1; size: number }) {
  const dx = turn * 5
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <ellipse cx="24" cy="24" rx="15" ry="18" fill="#ecfdf5" stroke={GREEN} strokeWidth="2" />
      <circle cx={18 + dx} cy="21" r="1.8" fill={DEEP} />
      <circle cx={30 + dx} cy="21" r="1.8" fill={DEEP} />
      <path d={`M${24 + dx * 1.4},23 l${turn < 0 ? -3 : turn > 0 ? 3 : 0},6 h${turn === 0 ? 2 : 0}`} fill="none" stroke={DEEP} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M${19 + dx},33 q5,3 10,0`} fill="none" stroke={DEEP} strokeWidth="1.6" strokeLinecap="round" />
      {turn !== 0 && <path d={turn < 0 ? 'M6,24 l4,-3 v6z' : 'M42,24 l-4,-3 v6z'} fill={GREEN} />}
    </svg>
  )
}
