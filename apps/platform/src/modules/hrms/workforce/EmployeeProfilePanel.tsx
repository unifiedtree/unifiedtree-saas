// A directory row's quick profile (the Master design's EmpProfile) on the kit side panel:
// employment facts, contact, who they report to, the rules of their employment type, and
// Start exit · Full record · Close · Edit details. Same facts and links as before.
import { Avatar, Callout, Chip, KeyValueGrid, StatusPill, CellPerson } from '@/design/kit/display'
import { PanelButton, SidePanel } from '@/design/kit/overlays'
import { NONE, TODAY } from '@/design/master/masterRuntime'
import type { Rec } from '../master/masterData'
import { daysTo, fmtDate, isLeaving, shiftHours, statusTone, tenure } from './directoryModel'
import { useMaps, useMasterApp } from './masterApp'

export interface EmployeeProfilePanelProps {
  e: Rec
  /** May edit people and start exits (hrms.employee.write). */
  canWrite: boolean
  onClose: () => void
  onEdit: () => void
  onExit: () => void
}

export function EmployeeProfilePanel({ e, canWrite, onClose, onEdit, onExit }: EmployeeProfilePanelProps) {
  const { db, go, act } = useMasterApp()
  const M = useMaps(db)
  const dp = M.dept[e.dept], ds = M.desig[e.desig], br = M.branch[e.branch], co = M.co[e.co], gr = M.grade[e.grade], sh = M.shift[e.shift] || null
  const parent = dp.parent ? M.dept[dp.parent] : null
  const mgr = e.mgrId ? M.emp[e.mgrId] : null
  const cls = db.classes.find((c) => c.type === e.type) || db.classes[0] || (NONE.cls as Rec)
  const leaves = db.leaves.filter((l) => l.status === 'Active' && (!l.applies || l.applies.includes(cls.id))).length
  const leaving = isLeaving(e)

  return (
    <SidePanel open onClose={onClose} width={560} title="Employee profile" sub={`${e.code} · on record since ${fmtDate(e.joined)}`} footerAlign="between"
      footer={<>
        <span className="wf-foot-start">{canWrite && !leaving && <PanelButton size="lg" variant="ghost" icon="logOut" onClick={onExit}>Start exit</PanelButton>}</span>
        <span className="wf-foot-end">
          <PanelButton size="lg" onClick={() => act.openRecord(e.id)}>Full record</PanelButton>
          <PanelButton size="lg" onClick={onClose}>Close</PanelButton>
          {canWrite && <PanelButton size="lg" variant="primary" icon="pencil" onClick={onEdit}>Edit details</PanelButton>}
        </span>
      </>}>
      <div className="wf-prof">
        <div className="wf-prof__head">
          <Avatar name={e.name} size={56} tone="pale" />
          <div className="wf-prof__id">
            <h3>{e.name}</h3>
            <p>{ds.name} · {dp.name}</p>
            <div className="wf-chips">
              <StatusPill tone={statusTone(e.status)} dot>{e.statusLabel || e.status}</StatusPill>
              <Chip>{e.type}</Chip>
              {gr && <Chip>{gr.id} · {gr.name}</Chip>}
            </div>
          </div>
        </div>
        {e.status === 'On notice' && <Callout tone="leave" icon="clock">Serving notice — last working day is <b>{fmtDate(e.lwd)}</b>, {daysTo(e.lwd, TODAY)} days from now.</Callout>}
        {e.status === 'Probation' && <Callout tone="amber" icon="timer">{e.probEnd ? <>On probation until <b>{fmtDate(e.probEnd)}</b>.</> : 'On probation — no confirmation date is set yet.'}</Callout>}
        {e.status === 'Exited' && <Callout tone="neutral" icon="archive">Exited on <b>{fmtDate(e.exitOn)}</b>. The record is kept for statutory and payroll history.</Callout>}

        <section className="wf-prof__sec" aria-label="Employment">
          <h4>Employment</h4>
          <KeyValueGrid items={[
            { label: 'Department', value: dp.name + (parent ? ` · ${parent.name}` : '') },
            { label: 'Designation', value: ds.name },
            { label: 'Company', value: co?.name || '—' },
            { label: 'Branch', value: br.name + (br.city ? `, ${br.city}` : '') },
            { label: 'Shift', value: sh ? `${sh.name} · ${shiftHours(sh)}` : '—' },
            { label: 'Tenure', value: tenure(e.joined, TODAY) },
          ]} />
        </section>
        <section className="wf-prof__sec" aria-label="Contact">
          <h4>Contact</h4>
          <KeyValueGrid items={[{ label: 'Work email', value: e.email || '—' }, { label: 'Mobile', value: e.phone || '—' }]} />
        </section>
        <section className="wf-prof__sec" aria-label="Reports to">
          <h4>Reports to</h4>
          {mgr ? <CellPerson name={mgr.name} sub={`${M.desig[mgr.desig].name} · ${M.dept[mgr.dept].name}`} />
            : dp.id && !dp.headId
              ? <button type="button" className="wf-link wf-link--warn" onClick={() => go('departments')}>{dp.name} has no head yet — assign one</button>
              : <span className="wf-muted">No reporting manager set</span>}
        </section>
        <section className="wf-prof__sec" aria-label="Rules that apply">
          <h4>Rules that apply</h4>
          <div className="wf-chips">
            <Chip>Probation · {cls.probation}</Chip>
            <Chip>Notice · {cls.notice ? `${cls.notice} days` : '—'}</Chip>
            {cls.pf === true && <Chip>PF &amp; ESI eligible</Chip>}
            <Chip>{leaves} leave types</Chip>
          </div>
        </section>
      </div>
    </SidePanel>
  )
}
