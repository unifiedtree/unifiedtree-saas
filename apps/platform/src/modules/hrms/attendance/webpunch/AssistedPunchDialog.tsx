// "Punch for a team member" on the web: the assisted face punch the mobile app has (V143.40), with
// this computer's camera. A manager punches their team (attendance.assisted_punch.team), HR anyone
// in the company (attendance.assisted_punch.any).
//   GET  /v1/attendance/assisted-punch/eligible?q=   who you may punch for, their face and today's punch
//   POST /v1/attendance/assisted-punch               { employeeId, type, imageBase64, challengePerformed, latitude, longitude, accuracy, deviceId }
// The server checks everything the phone's punch checks: the scope, the face against THEIR
// enrolment (with its lockout), your location against their work area (WFH and "Anywhere" lift
// it), one punch in and out a day; the day then shows "Punched by" you.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { errorCodeOf, httpStatusOf } from '@/core/api/featureNotReady'
import { Button, CellPerson, StatusPill } from '@/design/kit/display'
import { Dialog, Input, useToast } from '@/design/kit/overlays'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { deviceLabel } from './webPunch'
import { refreshAfterPunch } from './useMyDay'
import { useCamera } from './useCamera'
import { useSpot } from './useSpot'
import { CameraBox, PunchNote, Step } from './CameraParts'

interface Eligible {
  employeeId: string; employeeCode: string; fullName: string; jobTitle?: string | null; departmentName?: string | null
  profilePhotoUrl?: string | null
  /** ENROLLED · NOT_ENROLLED · LOCKED · NO_LOGIN */
  faceStatus: string
  /** NOT_PUNCHED · PUNCHED_IN · PUNCHED_OUT */
  todayStatus: string
  checkInTime?: string | null; checkOutTime?: string | null; sinceYesterday?: boolean
}
interface EligibleList { scope: string; employees: Eligible[]; truncated: boolean }
interface PunchResponse { employeeName: string; type: string; punchedAt: string; attendanceStatus?: string }

export interface AssistedPunchDialogProps {
  open: boolean
  onClose: () => void
  /** Open straight on this person (from a Daily Logs row). */
  employeeId?: string
  onDone?: () => void
}

export function AssistedPunchDialog(props: AssistedPunchDialogProps) {
  if (!props.open) return null
  return <OpenAssisted {...props} />
}

const nextPunch = (e: Eligible): 'CHECK_IN' | 'CHECK_OUT' | null =>
  e.todayStatus === 'NOT_PUNCHED' ? 'CHECK_IN' : e.todayStatus === 'PUNCHED_IN' ? 'CHECK_OUT' : null

/** Why this person can't be punched now, or null. */
function blocker(e: Eligible): string | null {
  const first = e.fullName.split(' ')[0]
  if (e.faceStatus === 'NO_LOGIN') return `${first} has no app login, so there is no enrolled face to check.`
  if (e.faceStatus === 'NOT_ENROLLED') return `${first} hasn’t enrolled their face yet. They enrol once, in the app or on the web.`
  if (e.faceStatus === 'LOCKED') return `${first}’s face check is locked after several failed tries. HR can reset it.`
  if (e.todayStatus === 'PUNCHED_OUT') return `${first} has already punched in and out today.`
  return null
}

/** The assisted punch's refusals, in plain words (the server's own sentence otherwise). */
function refusalText(err: unknown): string {
  const code = errorCodeOf(err)
  const said = err instanceof Error ? err.message : ''
  if (code === 'FACE_WORKER_UNAVAILABLE') return 'The face check isn’t available right now. Try again in a moment.'
  if (httpStatusOf(err) === 403 && !said) return 'You can’t punch for this person.'
  if (err instanceof TypeError) return 'Can’t reach the server. Check your connection and try again.'
  return said && !/^Request failed/.test(said) ? said : 'The punch couldn’t be saved. Try again.'
}

function OpenAssisted({ onClose, employeeId, onDone }: AssistedPunchDialogProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const search = useDebounce(q, 300)
  const [pickedId, setPickedId] = useState<string | null>(employeeId ?? null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const list = useQuery({
    queryKey: ['attendance', 'assisted-punch', 'eligible', search],
    queryFn: () => apiJson<EligibleList>(`/v1/attendance/assisted-punch/eligible${search ? `?q=${encodeURIComponent(search)}` : ''}`),
    staleTime: 15_000,
  })
  const people = useMemo(() => list.data?.employees ?? [], [list.data])
  const person = useMemo(() => people.find((p) => p.employeeId === pickedId) || null, [people, pickedId])
  const type = person ? nextPunch(person) : null
  const stop = person ? blocker(person) : null
  const scanning = !!person && !!type && !stop

  const where = useSpot(scanning, false, 'punch')
  const cam = useCamera(scanning, 'Camera ready. Point it at their face.')
  const first = person?.fullName.split(' ')[0] ?? ''

  const go = async () => {
    if (!person || !type || busy || !where.spot) return
    const frame = cam.capture()
    if (!frame) { setProblem('The camera isn’t ready yet. Wait a moment, then try again.'); return }
    setBusy(true); setProblem(null)
    try {
      const r = await apiJson<PunchResponse>('/v1/attendance/assisted-punch', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: person.employeeId, type, imageBase64: frame.base64, challengePerformed: 'BLINK',
          latitude: where.spot.latitude, longitude: where.spot.longitude, accuracy: where.spot.accuracy, deviceId: deviceLabel(),
        }),
      })
      cam.stop()
      refreshAfterPunch(qc)
      qc.invalidateQueries({ queryKey: ['attendance', 'assisted-punch'] })
      toast.success(`${r.employeeName || person.fullName} ${type === 'CHECK_IN' ? 'punched in' : 'punched out'}${r.punchedAt ? ` at ${r.punchedAt}` : ''}. Their face was verified.`)
      onDone?.()
      onClose()
    } catch (e) {
      setProblem(refusalText(e))
      void list.refetch()
    } finally { setBusy(false) }
  }

  const close = () => { if (!busy) { cam.stop(); onClose() } }

  return (
    <Dialog open onClose={close} busy={busy} width={person ? 760 : 560} icon="scanFace"
      title={person ? `${type === 'CHECK_OUT' ? 'Punch out' : 'Punch in'} ${person.fullName}` : 'Punch for a team member'}
      sub={person ? 'Point this computer’s camera at their face. The day shows that you punched them.' : 'Pick the person, then scan their face with this computer’s camera.'}>
      {!person ? (
        <div className="uwp-pick">
          <Input aria-label="Find a person" placeholder="Find by name or code" leading="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {list.isLoading ? <p className="uwp-line" data-state="wait" role="status">Loading the people you can punch for…</p>
            : list.isError ? (
              <>
                <PunchNote tone="bad">{httpStatusOf(list.error) === 403 ? 'You don’t have permission to punch for other people.' : 'Couldn’t load the people you can punch for.'}</PunchNote>
                {httpStatusOf(list.error) !== 403 && <Button onClick={() => void list.refetch()}>Try again</Button>}
              </>
            ) : people.length === 0 ? <p className="uwp-fine">{search ? 'No one matches.' : 'There’s nobody you can punch for.'}</p> : (
              <ul className="uwp-people" aria-label="People you can punch for">
                {people.map((p) => {
                  const t = nextPunch(p)
                  return (
                    <li key={p.employeeId}>
                      <button type="button" className="uwp-person" onClick={() => { setPickedId(p.employeeId); setProblem(null) }}>
                        <CellPerson name={p.fullName} sub={[p.employeeCode, p.departmentName].filter(Boolean).join(' · ')} src={p.profilePhotoUrl} />
                        <span className="uwp-person__tags">
                          {p.faceStatus !== 'ENROLLED' && <StatusPill tone="muted" size="xs">{p.faceStatus === 'LOCKED' ? 'Face locked' : 'No face yet'}</StatusPill>}
                          <StatusPill tone={t === 'CHECK_IN' ? 'brand' : t === 'CHECK_OUT' ? 'amber' : 'muted'} size="xs">
                            {t === 'CHECK_IN' ? 'Punch in' : t === 'CHECK_OUT' ? `Out · in ${p.checkInTime ?? ''}`.trim() : 'Done today'}
                          </StatusPill>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          {list.data?.truncated && <p className="uwp-fine">Showing the first {people.length}. Search to find someone else.</p>}
        </div>
      ) : (
        <div className="uwp" data-busy={busy ? '' : undefined}>
          <CameraBox videoRef={cam.videoRef} on={scanning} scanning={busy} label={`Camera preview for ${person.fullName}`} />
          <div className="uwp-side">
            <CellPerson name={person.fullName} sub={[person.employeeCode, person.departmentName].filter(Boolean).join(' · ')} src={person.profilePhotoUrl} />
            {stop ? <PunchNote tone="warn">{stop}</PunchNote> : (
              <>
                <ul className="uwp-steps" aria-label="Before you continue">
                  <Step line={cam.line} />
                  <Step line={where.line} />
                </ul>
                {problem && <PunchNote tone="bad">{problem}</PunchNote>}
                <Button variant="primary" size={44} block loading={busy}
                  disabled={busy || cam.line.state !== 'ok' || where.line.state !== 'ok'} onClick={() => void go()}>
                  {`Verify and punch ${first} ${type === 'CHECK_OUT' ? 'out' : 'in'}`}
                </Button>
                {(cam.line.state === 'bad' || where.line.state === 'bad') && (
                  <div className="uwp-retry">
                    {cam.line.state === 'bad' && <Button variant="ghost" size={32} onClick={cam.retry}>Try the camera again</Button>}
                    {where.line.state === 'bad' && <Button variant="ghost" size={32} onClick={where.retry}>Check my location again</Button>}
                  </div>
                )}
              </>
            )}
            {!employeeId && <Button variant="ghost" size={32} onClick={() => { cam.stop(); setPickedId(null); setProblem(null) }} disabled={busy}>Pick someone else</Button>}
            <p className="uwp-fine">The photo is used for this check only and isn’t saved.</p>
          </div>
        </div>
      )}
    </Dialog>
  )
}
