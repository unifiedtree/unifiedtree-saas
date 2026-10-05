// "Fix a day" (EmpTime fix-a-day, Regularization's New request): ask for a missed or wrong punch to
// be corrected. POST /v1/attendance/corrections (attendance.checkin.self) with the day, the times
// (IST, as the page labels them) and the reason, plus optional proof (uploaded when it's chosen,
// POST /corrections/attachments). Who it goes to comes from GET /v1/me/approvers?for=correction
// (BW-122); without that endpoint the line is left out. The day is picked on the "Select date"
// picker (single day, weekly offs and holidays marked), as the app's correction form.
import { useState } from 'react'
import { Callout } from '@/design/kit/display'
import { FieldGrid, FormField, Input, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { DateRangeButton, DateRangeDialog } from '@/design/kit/DateRangePicker'
import { addDays, istToday } from '@/design/dc/dates'
import { useCreateCorrection } from '../../api/useAttendance'
import { uploadCorrectionProof } from '../../api/useAttendanceReview'
import { useApprovers } from '../../api/shared/useApprovers'
import { useMyWorkCalendar } from '../useMyWorkCalendar'

const t2m = (t: string) => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

export interface FixDayPrefill { date?: string; in?: string; out?: string; reason?: string }

export function FixDayPanel({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: FixDayPrefill }) {
  if (!open) return null
  return <OpenFix onClose={onClose} prefill={prefill} />
}

function OpenFix({ onClose, prefill }: { onClose: () => void; prefill?: FixDayPrefill }) {
  const toast = useToast()
  const today = istToday()
  const [date, setDate] = useState(prefill?.date || addDays(today, -1))
  const [inAt, setIn] = useState(prefill?.in || '09:00')
  const [outAt, setOut] = useState(prefill?.out || '18:00')
  const [reason, setReason] = useState(prefill?.reason || '')
  const [proof, setProof] = useState<{ name: string; url?: string; busy?: boolean; error?: string } | null>(null)
  const [tried, setTried] = useState(false)
  const [picking, setPicking] = useState(false)
  const calendar = useMyWorkCalendar(addDays(today, -366), today)
  const create = useCreateCorrection()
  const approver = useApprovers('correction')
  const goesTo = approver.notAvailable ? null : approver.data?.approver?.name ?? null

  const problems = {
    date: !date ? 'Choose the day.' : date > today ? 'You can only fix a day that has happened.' : null,
    time: !inAt || !outAt ? 'Enter both times.' : t2m(outAt) <= t2m(inAt) ? 'The time you left must be after the time you came in.' : null,
    reason: !reason.trim() ? 'Say what happened, e.g. “Forgot to punch out”.' : null,
  }
  const blocked = problems.date || problems.time || problems.reason || (proof?.busy ? 'Wait for the proof to attach.' : null)

  const onProof = async (file: File | undefined) => {
    if (!file) { setProof(null); return }
    const okType = /\.(pdf|jpe?g|png)$/i.test(file.name) || /^(application\/pdf|image\/(jpeg|png))$/.test(file.type)
    if (!okType) { setProof({ name: file.name, error: 'Choose a PDF, JPG or PNG file.' }); return }
    if (file.size > 5 * 1024 * 1024) { setProof({ name: file.name, error: 'This file is over 5 MB. Choose a smaller one.' }); return }
    setProof({ name: file.name, busy: true })
    try {
      const up = await uploadCorrectionProof(file)
      setProof({ name: up.fileName || file.name, url: up.attachmentUrl })
    } catch (e) {
      setProof({ name: file.name, error: (e as Error)?.message || 'Couldn’t attach it. Try again, or send the request without it.' })
    }
  }

  const send = () => {
    setTried(true)
    if (blocked || create.isPending) return
    create.mutateAsync({
      requestedDate: date,
      requestedCheckInAt: new Date(`${date}T${inAt}:00+05:30`).toISOString(),
      requestedCheckOutAt: new Date(`${date}T${outAt}:00+05:30`).toISOString(),
      reason: reason.trim(),
      ...(proof?.url ? { attachmentUrl: proof.url } : {}),
    }).then(() => {
      toast.success(proof?.url ? 'Fix request sent with your proof' : 'Fix request sent')
      onClose()
    }).catch((e) => toast.error('Could not send the request', { detail: (e as Error)?.message }))
  }

  return (
    <SidePanel open onClose={onClose} title="Fix a day" sub="Ask for a missed or wrong punch to be corrected. Times are in IST." busy={create.isPending}
      footer={(
        <>
          <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
          <PanelButton size="lg" variant="primary" busy={create.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={send}>
            Send request
          </PanelButton>
        </>
      )}>
      <FieldGrid columns={2}>
        <FormField full error={tried ? problems.date : undefined}>
          <DateRangeButton single from={date} startLabel="Which day" invalid={tried && !!problems.date} onOpen={() => setPicking(true)} />
        </FormField>
        <Input label="Came in at" type="time" value={inAt} onChange={(e) => setIn(e.target.value)} />
        <Input label="Left at" type="time" value={outAt} onChange={(e) => setOut(e.target.value)} error={tried ? problems.time : undefined} />
        <Textarea label="What happened" required full rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Forgot to punch out" error={tried ? problems.reason : undefined} />
        <Input label="Proof (optional)" full type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(e) => void onProof(e.target.files?.[0])} disabled={create.isPending}
          hint={!proof ? 'A gate log, an email or a photo. PDF or image, up to 5 MB.'
            : proof.busy ? `Attaching ${proof.name}…` : proof.error ? undefined : `Attached: ${proof.name}. HR sees it with your request.`}
          error={proof?.error ? `${proof.name}: ${proof.error}` : undefined} />
      </FieldGrid>
      {goesTo && <Callout tone="neutral" icon="userCheck">It goes to <b>{goesTo}</b> for approval.</Callout>}
      <DateRangeDialog open={picking} onClose={() => setPicking(false)} mode="single" title="Select day" from={date} max={today} today={today}
        calendar={calendar} onDone={(r) => { setDate(r.from); setPicking(false) }} />
    </SidePanel>
  )
}
