// Admin: Ask payroll — the payroll team's queue of open and answered payslip
// questions. A FIN user clicks "Answer", writes a reply inside the side panel,
// and the employee is notified without the answer's text. HR without
// payroll.runs.manage can read the queue but Answer stays disabled (the API
// refuses it with 403). An answered question can be removed by the asker.
// Source: GET /v1/payroll/queries, POST /v1/payroll/queries/{id}/answer,
// DELETE /v1/payroll/queries/{id} (BW-59).
import { useState } from 'react'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, Section, StatusPill, Skeleton, errorText } from '@/design/kit/display'
import { SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'
import { useAnswerPayQuery, useDeletePayQuery, usePayQueries, type PayslipQuery } from '../../api/usePayrollRuns'

type Scope = 'OPEN' | 'ANSWERED' | 'ALL'

export function AskPayrollQueue() {
  const canAnswer = usePermission(P.PAYROLL_RUNS_MANAGE)
  const [scope, setScope] = useState<Scope>('OPEN')
  const q = usePayQueries(scope)
  const [sel, setSel] = useState<PayslipQuery | null>(null)
  const [draft, setDraft] = useState('')
  const answer = useAnswerPayQuery()
  const remove = useDeletePayQuery()
  const toast = useToast()

  const rows = q.data ?? []
  const notReady = q.error && String((q.error as Error).message || '').includes('FEATURE_NOT_READY')

  const openPanel = (row: PayslipQuery) => { setSel(row); setDraft(row.answer ?? '') }
  const closePanel = () => { setSel(null); setDraft('') }

  const send = async () => {
    if (!sel) return
    const text = draft.trim()
    if (text.length < 2) return
    try {
      await answer.mutateAsync({ id: sel.id, answer: text })
      toast.success('Answer sent')
      closePanel()
    } catch (err) {
      toast.error((err as Error).message || 'Couldn’t send the answer')
    }
  }

  if (notReady) {
    return (
      <Section title="Ask payroll" sub="Payslip questions and your answers">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>Not switched on yet.</p>
      </Section>
    )
  }

  return (
    <>
      <Section title="Ask payroll" sub={`Payslip questions and your answers (${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`}
        loading={q.isLoading} error={q.error} onRetry={() => { q.refetch() }}
        actions={
          <div role="group" aria-label="Payslip question views" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--u-hv,#F0F4F2)' }}>
            {(['OPEN', 'ANSWERED', 'ALL'] as const).map((v) => {
              const on = scope === v
              const label = v === 'OPEN' ? 'Open' : v === 'ANSWERED' ? 'Answered' : 'All'
              return (
                <button key={v} type="button" onClick={() => setScope(v)} aria-pressed={on}
                  style={{ height: 30, padding: '0 14px', border: 0, borderRadius: 999, cursor: 'pointer',
                    background: on ? 'var(--u-sf,#fff)' : 'transparent',
                    boxShadow: on ? '0 1px 2px rgba(14,27,22,.1)' : 'none',
                    fontSize: 13, fontWeight: 500, color: on ? 'var(--u-ink,#0E1B16)' : 'var(--u-ink2,#4A5A54)' }}>
                  {label}
                </button>
              )
            })}
          </div>
        }
        empty={!q.isLoading && !q.error && rows.length === 0
          ? { title: scope === 'OPEN' ? 'No open questions' : scope === 'ANSWERED' ? 'No answered questions yet' : 'No questions yet', hint: 'Questions sent from an employee’s payslip appear here.' }
          : undefined}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <article key={r.id} style={{ display: 'grid', gap: 8, padding: '14px 16px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 14, background: 'var(--u-sf,#fff)' }}>
              <header style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 14, color: 'var(--u-ink,#0E1B16)' }}>{r.employeeName ?? 'An employee'}</strong>
                  {r.employeeCode && <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>· {r.employeeCode}</span>}
                  <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>· {r.period}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusPill tone={r.status === 'OPEN' ? 'warning' : 'success'}>{r.status === 'OPEN' ? 'Open' : 'Answered'}</StatusPill>
                  <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>Asked {fmtShort(r.createdAt.slice(0, 10))}</span>
                </div>
              </header>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--u-ink,#0E1B16)', whiteSpace: 'pre-wrap' }}>{r.message}</p>
              {r.answer && (
                <div style={{ padding: '10px 12px', background: 'var(--u-brs,#E8F3EE)', border: '1px solid var(--u-brl,#BFDFD1)', borderRadius: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--u-brt,#0F6E56)' }}>
                    Answered{r.answeredByName ? ` · ${r.answeredByName}` : ''}{r.answeredAt ? ` · ${fmtShort(r.answeredAt.slice(0, 10))}` : ''}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--u-ink,#0E1B16)', whiteSpace: 'pre-wrap' }}>{r.answer}</p>
                </div>
              )}
              <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {r.status === 'OPEN'
                  ? <Button size={32} onClick={() => openPanel(r)} disabled={!canAnswer} aria-label={canAnswer ? 'Answer this question' : 'Only the payroll team can answer'}>Answer</Button>
                  : <Button size={32} variant="ghost" onClick={async () => {
                    try { await remove.mutateAsync(r.id); toast.success('Question removed') } catch (err) { toast.error(errorText(err)) }
                  }}>Remove</Button>}
              </footer>
            </article>
          ))}
          {q.isLoading && <Skeleton height={120} />}
        </div>
      </Section>
      <SidePanel open={!!sel} onClose={closePanel} title={sel ? `Answer ${sel.employeeName || 'the employee'}` : ''}
        sub={sel ? `About ${sel.period} payroll` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={closePanel}>Cancel</Button>
            <Button onClick={send} disabled={draft.trim().length < 2 || answer.isPending} loading={answer.isPending}>Send answer</Button>
          </>
        }
      >
        {sel && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: '10px 12px', background: 'var(--u-sf2,#F7F9F8)', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--u-ink3,#6A7A73)' }}>Question</div>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--u-ink,#0E1B16)', whiteSpace: 'pre-wrap' }}>{sel.message}</p>
            </div>
            <Textarea label="Your answer" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={`e.g. Your ${sel.period} LOP comes from the three unpaid days…`} />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>
              The employee is notified. Only this answer shows on their payslip, not the text we send.
            </p>
          </div>
        )}
      </SidePanel>
    </>
  )
}
