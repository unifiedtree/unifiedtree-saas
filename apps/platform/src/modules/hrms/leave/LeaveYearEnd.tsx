// Leave accrual, the year-end carry forward and the balance audit trail
// (V143.23), for hrms.leave.yearend.run. Both jobs also run every night on
// their own (accrual daily; the carry forward in the first days of January);
// this view shows what they do and lets HR run them now.
import { useMemo, useState } from 'react'
import { Modal } from '@unifiedtree/ui-kit'
import { HrButton, HrSelect, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { dashIcon } from '@/design/dc/icons'
import { StatRow, SubHeading, State, RowList, Row, Panel, Note, Facts, days, stamp, todayIso } from '@/design/module/ModuleKit'
import { useCompanies } from '../api/useOrg'
import { useLeaveTypes } from '../api/useLeave'
import { useCarryForwardPreview, useRunCarryForward, useRunAccrual, useLeaveLedger, type LedgerEntry } from '../api/useLeaveYearEnd'

type Toast = (m: string, err?: boolean, d?: string) => void
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined)
const FREQ: Record<string, string> = { YEARLY: 'Upfront', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly' }
const KIND: Record<LedgerEntry['kind'], [string, PillTone]> = {
  ACCRUAL: ['Credited', 'ok'], CARRY_FORWARD: ['Carried forward', 'blue'], LAPSE: ['Lapsed', 'gray'], ENCASHMENT: ['Encashed', 'purple'],
}
const SHOWN = 50

/** The audit trail rows, for HR's view and the employee's Balances view. */
export function LedgerRows({ entries, showName }: { entries: LedgerEntry[]; showName?: boolean }) {
  return (
    <RowList>
      {entries.map((l) => {
        const [label, tone] = KIND[l.kind] || [l.kind, 'gray' as PillTone]
        return (
          <Row key={l.id}
            lead={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: '#f8fafc', border: '1px solid #eef2f6', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon(l.kind === 'ACCRUAL' ? 'calendarPlus' : l.kind === 'LAPSE' ? 'archive' : l.kind === 'ENCASHMENT' ? 'banknote' : 'calendarCheck', 17)}</span>}
            title={`${showName ? `${l.employeeName || 'Employee'}${l.employeeCode ? ` · ${l.employeeCode}` : ''} · ` : ''}${l.leaveTypeName || 'Leave'} · ${days(Number(l.days))}`}
            meta={`${l.note || l.period} · ${stamp(l.createdAt)}`}
            trail={<HrStatusPill tone={tone}>{label}</HrStatusPill>} />
        )
      })}
    </RowList>
  )
}

export function LeaveYearEnd({ toast }: { toast: Toast }) {
  const thisYear = Number(todayIso().slice(0, 4))
  const [year, setYear] = useState(thisYear - 1)
  const [asking, setAsking] = useState(false)
  const { data: companies = [] } = useCompanies()
  const { data: me } = useCurrentUser()
  const companyId = companies[0]?.id ?? me?.companyId ?? ''
  const types = useLeaveTypes(companyId)
  const preview = useCarryForwardPreview(year)
  const run = useRunCarryForward(), accrue = useRunAccrual()
  const ledger = useLeaveLedger()
  const accruing = (types.data ?? []).filter((t) => t.isActive && (t.accrualFrequency === 'MONTHLY' || t.accrualFrequency === 'QUARTERLY'))
  const lines = useMemo(() => (preview.data?.lines ?? []).filter((l) => !l.done), [preview.data])
  const credit = async () => {
    try {
      const r = await accrue.mutateAsync()
      toast(r.balancesCredited ? `${days(r.daysCredited)} credited` : 'Nothing was due', false,
        r.balancesCredited ? `${r.balancesCredited} balance(s) topped up for ${r.year}.` : 'Every monthly and quarterly balance already has what is due today.')
    } catch (e) { toast('Couldn’t credit leave', true, errMsg(e)) }
  }
  const carry = async () => {
    try {
      const r = await run.mutateAsync(year)
      setAsking(false)
      toast(r.processed ? `Carried forward from ${r.fromYear}` : 'Nothing left to carry forward', false,
        r.processed ? `${days(r.totalCarried)} moved into ${r.toYear}, ${days(r.totalLapsed)} lapsed.` : `Every balance from ${r.fromYear} was already done.`)
    } catch (e) { setAsking(false); toast('Couldn’t run the carry forward', true, errMsg(e)) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16, alignItems: 'start' }}>
        <Panel title="Monthly and quarterly credits" sub="Credited every night at 00:30 for the period just started, and when someone opens their balance. Upfront types get the whole quota at the start of the year."
          aside={<HrButton size="sm" variant="ghost" onClick={credit} disabled={accrue.isPending}>{accrue.isPending ? 'Crediting…' : 'Credit now'}</HrButton>}>
          {types.isLoading ? <State kind="loading" height={80} /> : accruing.length
            ? <Facts items={accruing.map((t) => ({ k: t.name, v: `${FREQ[t.accrualFrequency || 'YEARLY']} · ${days(t.annualEntitlement)} a year` }))} />
            : <Note>Every leave type is credited upfront. Choose monthly or quarterly in Leave rules.</Note>}
        </Panel>
        <Panel title="Year-end carry forward" sub="Unused days move into the next year up to each type’s cap; the rest lapse. It runs on its own in the first days of January, once for each person and leave type."
          aside={<div style={{ minWidth: 120 }}><HrSelect size="sm" value={String(year)} onChange={(v) => setYear(Number(v))}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(thisYear - n), label: `${thisYear - n} → ${thisYear - n + 1}` }))} /></div>}>
          {preview.isLoading ? <State kind="loading" height={80} />
            : preview.error ? <State kind="error" title="Couldn’t work out the carry forward" description={errMsg(preview.error)} onRetry={() => preview.refetch()} />
              : <>
                <StatRow min={140} tiles={[
                  { icon: 'calendarCheck', color: 'blue', label: 'Carried forward', value: days(preview.data?.totalCarried ?? 0), sub: `Into ${year + 1}` },
                  { icon: 'archive', color: 'orange', label: 'Lapses', value: days(preview.data?.totalLapsed ?? 0), sub: 'Above the caps' },
                  { icon: 'checkCircle', color: 'green', label: 'Already done', value: String(preview.data?.alreadyDone ?? 0), sub: 'Person × leave type' },
                ]} />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <HrButton onClick={() => setAsking(true)} disabled={!lines.length || run.isPending}>{lines.length ? `Run carry forward for ${year}` : `${year} is done`}</HrButton>
                </div>
              </>}
        </Panel>
      </div>
      {lines.length > 0 && <>
        <SubHeading aside={<span style={{ fontSize: 12.5, color: '#64748b' }}>{lines.length > SHOWN ? `First ${SHOWN} of ${lines.length}` : `${lines.length} to do`}</span>}>What the {year} carry forward will do</SubHeading>
        <RowList>
          {lines.slice(0, SHOWN).map((l) => (
            <Row key={`${l.employeeId}:${l.leaveTypeId}`} title={`${l.employeeName || 'Employee'}${l.employeeCode ? ` · ${l.employeeCode}` : ''} · ${l.leaveTypeName}`}
              meta={`${days(l.unused)} unused · ${days(l.carried)} carried into ${year + 1}${l.lapsed ? ` · ${days(l.lapsed)} lapse` : ''}`}
              trail={l.lapsed ? <HrStatusPill tone="warn">{`${days(l.lapsed)} lapse`}</HrStatusPill> : <HrStatusPill tone="blue">All carried</HrStatusPill>} />
          ))}
        </RowList>
      </>}
      <SubHeading>Audit trail</SubHeading>
      {ledger.isLoading ? <State kind="loading" />
        : ledger.error ? <State kind="error" title="Couldn’t load the audit trail" description={errMsg(ledger.error)} onRetry={() => ledger.refetch()} />
          : (ledger.data ?? []).length === 0 ? <State kind="empty" icon="fileText" title="Nothing recorded yet" description="Monthly and quarterly credits, carry forwards, lapses and encashments are listed here as they happen." />
            : <LedgerRows entries={ledger.data ?? []} showName />}
      <Modal open={asking} onOpenChange={(o: boolean) => { if (!o) setAsking(false) }} title={`Run the ${year} carry forward?`}
        description={`${days(preview.data?.totalCarried ?? 0)} move into ${year + 1} and ${days(preview.data?.totalLapsed ?? 0)} lapse. Lapsed days can’t be given back from the app. Each person and leave type is done once, so running it again changes nothing.`} size="sm">
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <HrButton variant="ghost" onClick={() => setAsking(false)}>Not now</HrButton>
          <HrButton variant="danger" onClick={carry} disabled={run.isPending}>{run.isPending ? 'Running…' : 'Run carry forward'}</HrButton>
        </div>
      </Modal>
    </div>
  )
}
