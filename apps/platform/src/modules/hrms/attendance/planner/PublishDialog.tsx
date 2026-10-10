// Publish (design §1.5 "Publish", §1.6 "Draft and publish"): the period, the people, which days are published (from
// today on), the full check — errors block, warnings need "Publish with N warnings" ticked — an optional note, and
// how many people will be told in the app. Until rosters drive attendance for the company the roster is information
// only (R8), and the dialog says so.
import { useEffect, useState } from 'react'
import { Callout, errorText } from '@/design/kit/display'
import { Checkbox, Dialog, PanelButton, Textarea } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'
import type { Checks } from '../../api/rosterTypes'
import { periodLabel, type PlannerState, type PublishReach } from './plannerModel'
import { datesLabel } from './preview/ScheduleCheck'

export const INFO_ONLY_NOTE = 'Publishing shows people their schedule. Until rosters drive attendance for the company, late marks, weekly offs and overtime still follow each person’s assigned shift.'

export function PublishDialog({ open, onClose, state, reach, checks, checking, checkError, onRetryCheck, busy, onPublish }: {
  open: boolean
  onClose: () => void
  state: PlannerState
  reach: PublishReach
  /** The full check of the saved roster (or the one a 409 answer carried). */
  checks: Checks | null
  checking: boolean
  checkError: unknown
  onRetryCheck: () => void
  busy: boolean
  onPublish: (acknowledgeWarnings: boolean, note: string) => void
}) {
  const [ack, setAck] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setAck(false); setNote('') } }, [open])
  const errors = checks?.errors ?? [], warnings = checks?.warnings ?? []
  const republish = state.status === 'PUBLISHED'
  const blocked = checking ? 'Checking the roster…'
    : checkError ? 'The check didn’t finish'
      : reach.past ? 'This roster ended before today'
        : errors.length ? `Fix ${errors.length === 1 ? 'the error' : `the ${errors.length} errors`} first`
          : warnings.length && !ack ? `Tick “Publish with ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}”`
            : note.length > 500 ? 'Keep the note under 500 characters' : null
  const told = republish ? 'People whose days change will be told in the app.' : `${reach.people} ${reach.people === 1 ? 'person' : 'people'} will be told in the app.`

  return (
    <Dialog open={open} onClose={onClose} busy={busy} width={560} icon="calendarCheck"
      title={republish ? 'Publish changes' : 'Publish roster'} sub={`${state.name} · ${periodLabel(state.startDate, state.endDate)}`}
      footer={(
        <>
          <PanelButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={busy} blockedReason={blocked} onClick={() => onPublish(warnings.length > 0 && ack, note.trim())}>
            {republish ? 'Publish changes' : 'Publish'}
          </PanelButton>
        </>
      )}>
      <div className="spl-publish">
        <dl className="spl-facts">
          <div><dt>People</dt><dd>{state.members.length}</dd></div>
          <div><dt>{reach.past ? 'Days to publish' : `Days from ${fmtShort(reach.from)}`}</dt><dd>{reach.past ? 'None' : reach.days}</dd></div>
          <div><dt>{republish ? `Version (now ${state.version})` : 'Version'}</dt><dd>{republish ? state.version + 1 : 1}</dd></div>
        </dl>
        <p className="spl-publish__line">Days before {reach.from === state.startDate ? 'the start' : 'today'} are never published or changed. {told}</p>
        <Callout tone="info" icon="info">{INFO_ONLY_NOTE}</Callout>
        {checking && <p className="spl-note">Checking the roster…</p>}
        {!!checkError && !checking && (
          <div className="spl-note" data-tone="red">Couldn’t run the check: {errorText(checkError, 'Try again in a moment.')} <button type="button" className="spl-link" onClick={onRetryCheck}>Try again</button></div>
        )}
        {errors.length > 0 && (
          <div className="spl-publish__block" data-level="error">
            <strong>{errors.length === 1 ? '1 error stops publishing' : `${errors.length} errors stop publishing`}</strong>
            <ul>{errors.slice(0, 8).map((i) => <li key={i.key}>{i.message}{i.dates.length ? <span className="apl-muted"> · {datesLabel(i.dates)}</span> : null}</li>)}</ul>
            {errors.length > 8 && <span className="apl-muted">and {errors.length - 8} more in the Schedule check</span>}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="spl-publish__block" data-level="warning">
            <strong>{warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}</strong>
            <ul>{warnings.slice(0, 8).map((i) => <li key={i.key}>{i.message}{i.dates.length ? <span className="apl-muted"> · {datesLabel(i.dates)}</span> : null}</li>)}</ul>
            {warnings.length > 8 && <span className="apl-muted">and {warnings.length - 8} more in the Schedule check</span>}
            {!errors.length && <Checkbox checked={ack} onChange={setAck} label={`Publish with ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`} />}
          </div>
        )}
        {checks && !checking && !errors.length && !warnings.length && <p className="spl-note" data-tone="green">The check found nothing to fix.</p>}
        <Textarea label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} hint="Kept with this version in the roster’s history." />
      </div>
    </Dialog>
  )
}
