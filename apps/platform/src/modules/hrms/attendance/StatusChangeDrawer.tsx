// "Change status" / "Excuse" / "Not them" for one employee-day (V143.10).
// Composed from existing parts only: HrDrawer, HrAvatar, HrStatusPill, HrSelect,
// HrButton, ModuleKit Facts + Note, and the ApprovalCard's note textarea style.
import { useState } from 'react'
import { HrAvatar, HrButton, HrDrawer, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { Facts, Note, dmy } from '@/design/module/ModuleKit'
import { statusLabel } from '../api/useAttendanceReview'

export interface StatusTarget {
  kind: 'status' | 'face-reject'
  employeeId: string
  name: string
  sub?: string
  /** yyyy-MM-dd */
  date: string
  status?: string | null
  note?: string | null
  manual?: boolean
  faceEventId?: string
  /** The face punch being rejected was a punch-out (only the check-out stops counting). */
  punchOut?: boolean
  /** Pre-selected choice, e.g. EXCUSE from the review list. */
  preset?: string
  facts?: { k: string; v: string }[]
}

const TONE: Record<string, 'ok' | 'late' | 'red' | 'gray' | 'purple'> = { PRESENT: 'ok', LATE: 'late', HALF_DAY: 'late', ABSENT: 'red', ON_LEAVE: 'purple' }
const textarea = { font: 'inherit', fontSize: 13, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, resize: 'vertical' as const, outline: 'none', color: '#0f172a', width: '100%', boxSizing: 'border-box' as const }

export function StatusChangeDrawer({ target, onClose, onSubmit }: {
  target: StatusTarget
  onClose: () => void
  /** Resolves true when saved (the drawer closes). */
  onSubmit: (target: StatusTarget, status: string, reason: string) => Promise<boolean>
}) {
  const face = target.kind === 'face-reject'
  const options = [
    { value: 'EXCUSE', label: 'Excuse it — counts as Present' },
    { value: 'PRESENT', label: 'Present' },
    { value: 'LATE', label: 'Late' },
    { value: 'HALF_DAY', label: 'Half day' },
    { value: 'ABSENT', label: 'Absent' },
    ...(target.manual ? [{ value: 'CLEAR', label: 'Remove the manual status — company rules decide' }] : []),
  ]
  const [status, setStatus] = useState(target.preset || (target.status === 'PRESENT' ? 'LATE' : 'EXCUSE'))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const first = (target.name || 'This person').split(' ')[0]
  const tooShort = reason.trim().length < 3
  const save = async () => {
    setTried(true)
    if (tooShort || busy) return
    setBusy(true)
    try { if (await onSubmit(target, face ? 'REJECTED' : status, reason.trim())) onClose() } finally { setBusy(false) }
  }
  const footer = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
      <HrButton variant="ghost" onClick={onClose}>Cancel</HrButton>
      <HrButton onClick={save} disabled={busy} data-tip={face ? 'Rejects the face punch' : 'Saves the new status'}>{busy ? 'Saving…' : face ? 'Not them — reject the punch' : 'Save status'}</HrButton>
    </div>
  )
  return (
    <HrDrawer title={face ? 'Not them?' : 'Change status'} onClose={onClose} footer={footer} width="max-w-md">
      <div style={{ display: 'grid', gap: 14, fontFamily: 'Inter,-apple-system,sans-serif', color: '#0f172a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <HrAvatar name={target.name} sub={target.sub} />
          {target.status && <HrStatusPill tone={TONE[target.status] || 'gray'}>{statusLabel(target.status)}</HrStatusPill>}
        </div>
        <Facts min={130} items={[{ k: 'Day', v: dmy(target.date) }, ...(target.facts || [])]} />
        {target.note && <Note>{target.note}</Note>}
        {!face && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>New status</span>
            <HrSelect value={status} onChange={(v: string) => setStatus(v)} options={options} />
          </div>
        )}
        <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
          {face ? 'Why isn’t it them? *' : 'Reason *'}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={face ? 'e.g. Someone else punched in on their phone' : 'e.g. Hospital visit, approved by the manager'} aria-invalid={tried && tooShort ? true : undefined} style={textarea} />
          {tried && tooShort && <span style={{ fontSize: 12, fontWeight: 600, color: '#be123c' }}>Add a reason (at least 3 characters).</span>}
        </label>
        {face
          ? <Note tone="amber">{target.punchOut
            ? `The check-out will no longer count, so the day shows “No check-out” for review. ${first} gets a notification with your note.`
            : `The punch will no longer count. The day becomes Absent (or Not marked yet, if it’s today) unless someone changes it. ${first} gets a notification with your note.`}</Note>
          : status === 'ABSENT' ? <Note tone="amber">Warning: an absent day is unpaid. Payroll can deduct a day’s pay for it.</Note>
            : status === 'HALF_DAY' ? <Note tone="amber">Warning: payroll can deduct half a day’s pay for a half day.</Note>
              : status === 'CLEAR' ? <Note>The company’s attendance rules decide this day again (grace, half-day rules and the late allowance).</Note>
                : null}
        {!face && <Note>{first} gets a notification with your reason. The change is saved with your name and shows in their attendance history.</Note>}
      </div>
    </HrDrawer>
  )
}
