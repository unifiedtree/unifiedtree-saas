// My payslips → "Ask payroll": the employee's own payslip questions and the
// payroll team's answers (/v1/payroll/payslips/me/queries, POST /{runId}/queries).
// A new question goes under a payslip; an answered question shows the answer below
// its question. The payroll team is notified without the question's text, so it
// never leaks through a notification body. See P-PAY-CORE §6.3 / BW-59.
import { useState, type FormEvent } from 'react'
import { Button, Section, StatusPill } from '@/design/kit/display'
import { useToast, Textarea } from '@/design/kit/overlays'
import { useMyPayQueries, useAskPayroll, type PayslipQuery } from '../../api/usePayrollRuns'
import { fmtShort } from '@/design/dc/dates'

export interface AskPayrollCardProps {
  /** The run the question is about (opened payslip). */
  runId: string
  periodLabel: string
}

const MIN = 6

function Thread({ q }: { q: PayslipQuery }) {
  return (
    <div style={{ display: 'grid', gap: 6, padding: '12px 14px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 12, background: 'var(--u-sf2,#F7F9F8)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <StatusPill tone={q.status === 'OPEN' ? 'warning' : 'success'}>{q.status === 'OPEN' ? 'Waiting on payroll' : 'Answered'}</StatusPill>
        <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>Asked {fmtShort(q.createdAt.slice(0, 10))}</span>
      </div>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--u-ink,#0E1B16)', whiteSpace: 'pre-wrap' }}>{q.message}</p>
      {q.answer && (
        <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--u-brs,#E8F3EE)', border: '1px solid var(--u-brl,#BFDFD1)', borderRadius: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--u-brt,#0F6E56)' }}>
            Answered{q.answeredByName ? ` · ${q.answeredByName}` : ''}{q.answeredAt ? ` · ${fmtShort(q.answeredAt.slice(0, 10))}` : ''}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--u-ink,#0E1B16)', whiteSpace: 'pre-wrap' }}>{q.answer}</p>
        </div>
      )}
    </div>
  )
}

export function AskPayrollCard({ runId, periodLabel }: AskPayrollCardProps) {
  const list = useMyPayQueries(runId)
  const ask = useAskPayroll(runId)
  const [draft, setDraft] = useState('')
  const toast = useToast()

  const notReady = list.error && String((list.error as Error).message || '').includes('FEATURE_NOT_READY')
  const rows = list.data ?? []
  const open = rows.filter((q) => q.status === 'OPEN')
  const answered = rows.filter((q) => q.status === 'ANSWERED')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const msg = draft.trim()
    if (msg.length < MIN) return
    try {
      await ask.mutateAsync(msg)
      setDraft('')
      toast.success('Payroll team notified')
    } catch (err) {
      toast.error((err as Error).message || 'Couldn’t send your question')
    }
  }

  if (notReady) {
    return (
      <Section title="Ask payroll" sub={`Questions about ${periodLabel} go to the payroll team`}>
        <p style={{ margin: 0, color: 'var(--u-ink3,#6A7A73)', fontSize: 13 }}>Not switched on yet. Ask HR directly if something looks wrong.</p>
      </Section>
    )
  }

  return (
    <Section title="Ask payroll" sub={`Questions about ${periodLabel} go to the payroll team. They see your message, not your figures.`}>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.length === 0 && !list.isLoading
          ? <p style={{ margin: 0, color: 'var(--u-ink3,#6A7A73)', fontSize: 13 }}>No questions yet.</p>
          : (
            <div style={{ display: 'grid', gap: 10 }}>
              {open.map((q) => <Thread key={q.id} q={q} />)}
              {answered.map((q) => <Thread key={q.id} q={q} />)}
            </div>
          )}
        <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--u-ink2,#4A5A54)' }} htmlFor="ask-payroll-msg">Your question</label>
          <Textarea id="ask-payroll-msg" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
            placeholder={`e.g. Why is my ${periodLabel} different from last month?`} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>
              {draft.trim().length < MIN ? `At least ${MIN} characters` : 'The payroll team will see this.'}
            </span>
            <Button type="submit" disabled={draft.trim().length < MIN || ask.isPending} loading={ask.isPending}>Send question</Button>
          </div>
        </form>
      </div>
    </Section>
  )
}
