// "Probation confirmations" (PgDashboard "upcoming"): people whose probation ends in the next 30 days, with
// Extend and Confirm for people who may change employee records (hrms.employee.write), today's view only.
// Extend asks for the new end date (the probation settings' auto-extend days ahead when readable, else 30);
// Confirm asks for the confirmation date (the probation end date). Both use the existing endpoints.
import { useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, Button, Section } from '@/design/kit/display'
import { DateInput, Dialog, useToast } from '@/design/kit/overlays'
import { addDays, fmtShort } from '@/design/dc/dates'
import { useExtendProbation, useProbationConfig, type UpcomingProbation } from '../api/useProbation'
import { useConfirmEmployee } from '../api/useWorkforce'

type Act = { kind: 'extend' | 'confirm'; p: UpcomingProbation; date: string }

const leftText = (d: number) => (d < 0 ? `${-d} ${-d === 1 ? 'day' : 'days'} overdue` : d === 0 ? 'Ends today' : d === 1 ? 'In 1 day' : `In ${d} days`)

export function ProbationCard({ rows, isPast, sel, canDecide, canReadConfig, loading, error, onRetry, onNavigate, style }: {
  rows: UpcomingProbation[]; isPast: boolean; sel: string; canDecide: boolean; canReadConfig: boolean
  loading: boolean; error: unknown; onRetry: () => void; onNavigate: (path: string) => void; style?: CSSProperties
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [act, setAct] = useState<Act | null>(null)
  const config = useProbationConfig(canDecide && canReadConfig && !isPast)
  const extend = useExtendProbation()
  const confirm = useConfirmEmployee()
  const busy = extend.isPending || confirm.isPending
  const extendDays = config.data?.autoExtendDays && config.data.autoExtendDays > 0 ? config.data.autoExtendDays : 30
  const first = (n: string) => n.split(' ')[0] || n

  const run = async () => {
    if (!act || !act.date) return
    try {
      if (act.kind === 'extend') {
        await extend.mutateAsync({ employeeId: act.p.employeeId, newEndDate: act.date })
        toast.success(`${first(act.p.employeeName)}’s probation now ends on ${fmtShort(act.date)}`)
      } else {
        await confirm.mutateAsync({ id: act.p.employeeId, confirmationDate: act.date })
        // The confirm hook doesn't refresh this list; the dashboard does.
        await qc.invalidateQueries({ queryKey: ['hrms', 'probation', 'upcoming'] })
        toast.success(`${first(act.p.employeeName)}’s probation is confirmed`)
      }
      setAct(null)
    } catch (e) {
      toast.error(act.kind === 'extend' ? 'Couldn’t extend the probation' : 'Couldn’t confirm the probation', { detail: (e as Error)?.message || 'Please try again.' })
    }
  }

  return (
    <Section variant="dashboard" level={3} title={isPast ? `Probation confirmations after ${fmtShort(sel)}` : 'Probation confirmations'}
      count={rows.length ? rows.length : null} sub={isPast ? `Ending in the 30 days after ${fmtShort(sel)}` : 'Ending in the next 30 days'}
      actions={<Button variant="plain" size={32} trailingIcon="arrowRight" onClick={() => onNavigate('/hrms/employees?status=PROBATION')}>View all</Button>}
      body="list" style={style} loading={loading} error={error} onRetry={onRetry}
      empty={!rows.length ? { title: isPast ? `None ending in the 30 days after ${fmtShort(sel)}` : 'None ending in the next 30 days', icon: 'calendarClock' } : undefined}>
      <div role="list" aria-label="Probations ending soon" className="ud-prob-list">
        {rows.map((r) => (
          <div key={r.employeeId} role="listitem" className="ud-prob-row">
            <button type="button" className="ud-link-row" onClick={() => onNavigate(`/hrms/employees/${r.employeeId}`)}
              title={r.managerName ? `Manager: ${r.managerName}` : undefined}>
              <Avatar name={r.employeeName} size={34} />
              <span className="ud-inbox-row__txt">
                <span className="ud-inbox-row__name" style={{ display: 'block' }}>{r.employeeName}</span>
                <span className="ud-inbox-row__sub" style={{ display: 'block' }}>Ends {fmtShort(r.probationEndDate).slice(0, -5)} · {leftText(r.daysRemaining)}</span>
              </span>
            </button>
            {canDecide && !isPast && (
              <>
                <button type="button" className="ud-sbtn" onClick={() => setAct({ kind: 'extend', p: r, date: addDays(r.probationEndDate, extendDays) })}
                  aria-label={`Extend ${r.employeeName}’s probation`}>Extend</button>
                <button type="button" className="ud-sbtn ud-sbtn--brand" onClick={() => setAct({ kind: 'confirm', p: r, date: r.probationEndDate })}
                  aria-label={`Confirm ${r.employeeName}’s probation`}>Confirm</button>
              </>
            )}
          </div>
        ))}
      </div>
      <Dialog open={!!act} onClose={() => { if (!busy) setAct(null) }} busy={busy}
        title={act?.kind === 'extend' ? 'Extend probation' : 'Confirm probation'}
        sub={act ? `${act.p.employeeName} · probation ends ${fmtShort(act.p.probationEndDate)}` : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setAct(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!act?.date} onClick={run}>{act?.kind === 'extend' ? 'Extend' : 'Confirm'}</Button>
        </>}>
        {act && (
          <DateInput label={act.kind === 'extend' ? 'New end date' : 'Confirmation date'} value={act.date}
            min={act.kind === 'extend' ? addDays(act.p.probationEndDate, 1) : undefined}
            onChange={(e) => setAct({ ...act, date: e.target.value })} />
        )}
      </Dialog>
    </Section>
  )
}
