// /station — the face station in a browser: a shared computer with a camera at one branch, where
// people punch in and out with their face. It runs on the station's own sign-in (an admin opened it
// from Attendance → Face stations, which signed them out here); the server lets that sign-in punch and
// nothing else. Punch in / out → find your name (2+ letters) → look at the camera → your photo, name
// and time, then back to the start. Design: docs/redesign/FACE_STATION.md.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, StatusPill } from '@/design/kit/display'
import { Input } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { CameraBox, PunchNote, Step } from '../webpunch/CameraParts'
import { useCamera } from '../webpunch/useCamera'
import { useSpot } from '../webpunch/useSpot'
import { clockIst, deviceLabel } from '../webpunch/webPunch'
import {
  forgetStation, readStation, saveStation, shouldRenew, stationCalls, stationProblem, stationSearch, successLines,
  type StationPeople, type StationPerson, type StationProblem, type StationPunchResult, type StationPunchType,
} from './stationApi'
import './station.css'

type StepName = 'start' | 'find' | 'camera' | 'working' | 'done' | 'error' | 'off'

const BACK_AFTER: Partial<Record<StepName, number>> = { find: 60_000, camera: 60_000, done: 8_000, error: 25_000 }

export function StationPage() {
  const [session, setSession] = useState(readStation)
  const [step, setStep] = useState<StepName>(session ? 'start' : 'off')
  const [type, setType] = useState<StationPunchType>('CHECK_IN')
  const [q, setQ] = useState('')
  const search = stationSearch(useDebounce(q, 300))
  const [people, setPeople] = useState<StationPeople | null>(null)
  const [loading, setLoading] = useState(false)
  const [person, setPerson] = useState<StationPerson | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [result, setResult] = useState<StationPunchResult | null>(null)
  const [problem, setProblem] = useState<StationProblem | null>(null)
  const [now, setNow] = useState(() => new Date().toISOString())

  const cam = useCamera(step === 'camera', 'Camera ready. Look straight at it.')
  const where = useSpot(step === 'camera', false, 'punch')

  const switchedOff = useCallback(() => { forgetStation(); setSession(null); setStep('off') }, [])
  const reset = useCallback(() => {
    setStep('start'); setQ(''); setPeople(null); setPerson(null); setPhoto(null); setResult(null); setProblem(null)
  }, [])

  // The clock, and the station's sign-in kept fresh (once a day is enough; checked every few hours).
  useEffect(() => { const t = setInterval(() => setNow(new Date().toISOString()), 30_000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!session) return
    const check = () => {
      const s = readStation()
      if (!s || !shouldRenew(s.expiresAt)) return
      stationCalls.renew().then((fresh) => { saveStation(fresh); setSession(fresh) })
        .catch((e) => { if (stationProblem(e).next === 'off') switchedOff() })
    }
    check()
    const t = setInterval(check, 6 * 3600 * 1000)
    return () => clearInterval(t)
  }, [session, switchedOff])

  // Nobody at the screen: back to the start.
  useEffect(() => {
    const ms = BACK_AFTER[step]
    if (!ms) return
    const t = setTimeout(reset, ms)
    return () => clearTimeout(t)
  }, [step, q, reset])

  // The search (2+ letters only: the station never lists the whole branch).
  useEffect(() => {
    if (step !== 'find' || !search) { setPeople(null); return }
    let live = true
    setLoading(true)
    stationCalls.people(search).then((r) => { if (live) setPeople(r) })
      .catch((e) => { if (!live) return; const p = stationProblem(e); if (p.next === 'off') switchedOff(); else setPeople({ people: [], truncated: false, hint: p.text }) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [search, step, switchedOff])

  const choose = (p: StationPerson) => {
    setPerson(p)
    if (!p.faceReady) {
      setProblem({ title: 'No face enrolled', text: `${p.fullName} hasn’t enrolled a face yet. Enrol it once in the app, then punch here.`, next: 'start' })
      setStep('error')
      return
    }
    setProblem(null)
    setStep('camera')
  }

  const go = async () => {
    if (!person || !where.spot) return
    const frame = cam.capture()
    if (!frame) { setProblem({ title: 'The camera isn’t ready', text: 'Wait a moment, then try again.', next: 'camera' }); return }
    setPhoto(frame.dataUrl)
    setStep('working')
    try {
      const r = await stationCalls.punch({
        employeeId: person.employeeId, type, imageBase64: frame.base64, challengePerformed: 'BLINK',
        latitude: where.spot.latitude, longitude: where.spot.longitude, accuracy: where.spot.accuracy, deviceId: deviceLabel(),
      })
      cam.stop()
      setResult(r)
      setStep('done')
    } catch (e) {
      const p = stationProblem(e)
      if (p.next === 'off') { switchedOff(); return }
      setProblem(p)
      setStep(p.next === 'camera' ? 'camera' : 'error')
    }
  }

  const info = session?.station
  const lines = useMemo(() => (result ? successLines(result) : null), [result])

  if (step === 'off' || !info) {
    return (
      <main className="ufs">
        <section className="ufs-card ufs-center" aria-live="polite">
          <span className="ufs-icon" data-tone="bad">{dashIcon('smartphone', 40)}</span>
          <h1 className="ufs-hero">This station is switched off</h1>
          <p className="ufs-lead">An admin can start it again from Attendance → Face stations.</p>
          <Button variant="primary" size={44} href="/login">Go to sign-in</Button>
        </section>
      </main>
    )
  }

  return (
    <main className="ufs">
      <header className="ufs-top">
        <div>
          <p className="ufs-name">{dashIcon('smartphone', 18)} {info.name}</p>
          {info.branchName && <p className="ufs-branch">{info.branchName}</p>}
        </div>
        <p className="ufs-clock" aria-label="Time now">{clockIst(now)}</p>
      </header>

      {step === 'start' && (
        <section className="ufs-card ufs-center">
          <span className="ufs-icon">{dashIcon('scanFace', 48)}</span>
          <h1 className="ufs-hero">Punch with your face</h1>
          <p className="ufs-lead">No phone needed. Choose, find your name, look at the camera.</p>
          <div className="ufs-big">
            <button type="button" className="ufs-bigbtn" data-tone="solid" onClick={() => { setType('CHECK_IN'); setStep('find') }}>
              {dashIcon('sunrise', 32)}<span>Punch in</span>
            </button>
            <button type="button" className="ufs-bigbtn" onClick={() => { setType('CHECK_OUT'); setStep('find') }}>
              {dashIcon('sunset', 32)}<span>Punch out</span>
            </button>
          </div>
          <p className="ufs-fine">Your photo is used only to check it’s you. Unclear matches are confirmed by your manager.</p>
        </section>
      )}

      {step === 'find' && (
        <section className="ufs-card">
          <div className="ufs-row">
            <h1 className="ufs-title">Find your name</h1>
            <StatusPill tone="brand">{type === 'CHECK_IN' ? 'Punch in' : 'Punch out'}</StatusPill>
          </div>
          <Input aria-label="Your name or employee code" placeholder="Type your name or employee code" leading="search" value={q}
            onChange={(e) => setQ(e.target.value)} autoFocus autoComplete="off" />
          {!search ? <p className="ufs-fine">Type at least 2 letters.</p>
            : loading && !people ? <p className="ufs-fine" role="status">Looking…</p>
              : people && people.people.length === 0 ? <p className="ufs-fine">{people.hint || 'No one matches. Check the spelling, or ask HR.'}</p>
                : (
                  <ul className="ufs-people" aria-label="People found">
                    {(people?.people ?? []).map((p) => (
                      <li key={p.employeeId}>
                        <button type="button" className="ufs-person" data-dim={p.faceReady ? undefined : ''} onClick={() => choose(p)}>
                          <span className="ufs-avatar" aria-hidden="true">{(p.fullName || '?').charAt(0).toUpperCase()}</span>
                          <span className="ufs-person__text">
                            <strong>{p.fullName}</strong>
                            <span>{[p.employeeCode, p.departmentName].filter(Boolean).join(' · ')}</span>
                          </span>
                          {!p.faceReady && <StatusPill tone="muted" size="xs">No face yet</StatusPill>}
                        </button>
                      </li>
                    ))}
                    {people?.truncated && <li className="ufs-fine">More people match. Type more of your name.</li>}
                  </ul>
                )}
          <Button variant="ghost" onClick={reset}>Cancel</Button>
        </section>
      )}

      {(step === 'camera' || step === 'working') && person && (
        <section className="ufs-card ufs-split">
          <CameraBox videoRef={cam.videoRef} on={step === 'camera' || step === 'working'} scanning={step === 'working'} label={`Camera for ${person.fullName}`} />
          <div className="ufs-side">
            <h1 className="ufs-title">{`${person.fullName.split(' ')[0]}, look at the camera`}</h1>
            <p className="ufs-fine">Only you in the frame, in even light.</p>
            <ul className="uwp-steps" aria-label="Before you punch">
              <Step line={cam.line} />
              <Step line={where.line} />
            </ul>
            {problem && <PunchNote tone="bad">{`${problem.title}. ${problem.text}`}</PunchNote>}
            <Button variant="primary" size={46} block loading={step === 'working'}
              disabled={step === 'working' || cam.line.state !== 'ok' || where.line.state !== 'ok'} onClick={() => void go()}>
              {step === 'working' ? 'Checking your face…' : type === 'CHECK_IN' ? 'Punch in now' : 'Punch out now'}
            </Button>
            {(cam.line.state === 'bad' || where.line.state === 'bad') && (
              <div className="uwp-retry">
                {cam.line.state === 'bad' && <Button variant="ghost" size={32} onClick={cam.retry}>Try the camera again</Button>}
                {where.line.state === 'bad' && <Button variant="ghost" size={32} onClick={where.retry}>Find the location again</Button>}
              </div>
            )}
            <Button variant="ghost" disabled={step === 'working'} onClick={() => { cam.stop(); setPerson(null); setProblem(null); setStep('find') }}>Not me</Button>
          </div>
        </section>
      )}

      {step === 'done' && result && lines && (
        <section className="ufs-card ufs-center" aria-live="polite">
          <span className="ufs-photo" data-wait={result.needsApproval ? '' : undefined}>
            {photo ? <img src={photo} alt="Your photo" /> : dashIcon('check', 48)}
            <span className="ufs-tick" aria-hidden="true">{dashIcon(result.needsApproval ? 'clock' : 'check', 18)}</span>
          </span>
          <h1 className="ufs-hero">{lines.title}</h1>
          <p className="ufs-note" data-wait={result.needsApproval ? '' : undefined}>{lines.note}</p>
          <dl className="ufs-facts">
            <div><dt>Name</dt><dd>{result.employeeName}</dd></div>
            <div><dt>Code</dt><dd>{result.employeeCode || '—'}</dd></div>
            <div><dt>Department</dt><dd>{result.departmentName || '—'}</dd></div>
            <div><dt>{result.type === 'CHECK_IN' ? 'Punched in' : 'Punched out'}</dt><dd>{clockIst(result.punchedAt) || '—'}</dd></div>
          </dl>
          <Button variant="primary" size={44} onClick={reset}>Done</Button>
        </section>
      )}

      {step === 'error' && (
        <section className="ufs-card ufs-center" aria-live="polite">
          <span className="ufs-icon" data-tone="bad">{dashIcon('alert', 40)}</span>
          <h1 className="ufs-hero">{problem?.title ?? 'Couldn’t punch'}</h1>
          <p className="ufs-lead">{problem?.text ?? 'Please try again.'}</p>
          <Button variant="primary" size={44} onClick={reset}>Start over</Button>
        </section>
      )}
    </main>
  )
}

export default StationPage
