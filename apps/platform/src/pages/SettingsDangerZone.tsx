// Workspace Settings -> Danger zone (/settings/danger).
//   Export all data  - workspace.data.export: a zip of CSVs per module, built
//                      in the background, emailed when ready, kept 7 days.
//   Reset / Delete   - workspace.lifecycle.manage, scheduled by an OWNER only:
//                      typed workspace name, 7-day wait, cancel any time
//                      before it is carried out, every owner and admin
//                      emailed. The app never deletes anything immediately.
import React, { useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Modal } from '@unifiedtree/ui-kit'
import { Download } from 'lucide-react'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { SettingsPage, SettingsSection, SettingsGrid, SettingsInput, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import {
  dayIst, fileSize, useExportActions, useExports, useLifecycle, useLifecycleActions, whenIst,
  type ExportRow, type LifecycleOverview, type LifecycleRequest,
} from './workspaceSettingsApi'

type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void
const ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }
const msg = (e: unknown) => (e as Error)?.message || 'Please try again.'

const EXPORT_PILL: Record<ExportRow['status'], { tone: PillTone; text: string }> = {
  QUEUED: { tone: 'info', text: 'Waiting to start' },
  RUNNING: { tone: 'info', text: 'Preparing' },
  READY: { tone: 'ok', text: 'Ready' },
  FAILED: { tone: 'red', text: 'Failed' },
  EXPIRED: { tone: 'gray', text: 'Deleted after 7 days' },
}

const ExportSection: React.FC<{ show: Show }> = ({ show }) => {
  const exports = useExports(true)
  const a = useExportActions()
  const list = exports.data ?? []
  const busy = list.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING')
  const start = () => a.start.mutate(undefined, {
    onSuccess: () => show('ok', 'Export started', 'It takes a few minutes. We’ll email you when it’s ready.'),
    onError: (e) => show('error', 'Couldn’t start the export', msg(e)),
  })
  const summary = exports.isLoading ? 'Loading…' : busy ? 'An export is being prepared' : list.some((e) => e.status === 'READY') ? 'An export is ready to download' : 'Download a full copy of the workspace data'
  return (
    <SettingsSection id="export" icon="download" title="Export all data" summary={summary}>
      <SettingsNote>You get one zip file with a spreadsheet (CSV) for every table, in a folder per module: people, attendance, leave, payroll, expenses and the rest, plus everyone’s sign-in access. It includes salaries, bank details and personal information. Passwords, sign-in secrets, face templates and full Aadhaar, passport and bank account numbers are left out; the README inside lists everything. It’s prepared in the background, the person who asked is emailed when it’s ready, and it can be downloaded for 7 days, then it is deleted.</SettingsNote>
      <div><HrButton onClick={start} disabled={busy || a.start.isPending}>{a.start.isPending ? 'Starting…' : busy ? 'Preparing an export…' : 'Prepare an export'}</HrButton></div>
      {exports.isLoading ? <SkeletonBlock className="h-16 w-full rounded-xl" />
        : exports.isError ? <SettingsNote tone="amber">We couldn’t load earlier exports just now.</SettingsNote>
          : list.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              {list.map((e) => {
                const pill = EXPORT_PILL[e.status]
                return (
                  <div key={e.id} style={ROW}>
                    <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid', gap: 4 }}>
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 14 }}>Requested {whenIst(e.createdAt)}</strong><HrStatusPill tone={pill.tone}>{pill.text}</HrStatusPill></span>
                      <span style={{ fontSize: 12.5, color: '#64748b' }}>
                        {e.requestedByEmail ? `by ${e.requestedByEmail}` : ''}
                        {e.status === 'READY' && <> · {e.tableCount} files · <span className="tabular-nums">{(e.rowCount ?? 0).toLocaleString('en-IN')}</span> rows · {fileSize(e.sizeBytes)} · available until {dayIst(e.expiresAt)}</>}
                        {e.downloadCount > 0 && <> · downloaded {e.downloadCount}×</>}
                      </span>
                      {e.error && <span style={{ fontSize: 12.5, color: e.status === 'FAILED' ? '#b91c1c' : '#92400e' }}>{e.error}</span>}
                    </div>
                    {e.status === 'READY' && (
                      <HrButton variant="ghost" onClick={() => a.download.mutate(e, { onError: (err) => show('error', 'Couldn’t download', msg(err)) })} disabled={a.download.isPending}>
                        <Download size={14} className="mr-1.5" />Download
                      </HrButton>
                    )}
                  </div>
                )
              })}
            </div>
          )}
    </SettingsSection>
  )
}

const ScheduleModal: React.FC<{ kind: 'RESET' | 'DELETE' | null; overview?: LifecycleOverview; onClose: () => void; show: Show }> = ({ kind, overview, onClose, show }) => {
  const a = useLifecycleActions()
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const name = overview?.workspaceName ?? ''
  const matches = typed.trim().replace(/\s+/g, ' ').toLowerCase() === name.trim().replace(/\s+/g, ' ').toLowerCase() && !!name
  const del = kind === 'DELETE'
  const close = () => { setTyped(''); setReason(''); onClose() }
  const submit = () => {
    if (!kind) return
    a.schedule.mutate({ kind, confirmName: typed.trim(), reason: reason.trim() || undefined }, {
      onSuccess: (r) => { close(); show('ok', del ? 'Deletion scheduled' : 'Reset scheduled', `Nothing happens before ${whenIst(r.scheduledFor)}. Every owner and admin has been emailed.`) },
      onError: (e) => show('error', 'Not scheduled', msg(e)),
    })
  }
  return (
    <Modal open={!!kind} onOpenChange={(o: boolean) => { if (!o) close() }} size="sm"
      title={del ? 'Schedule deletion of this workspace?' : 'Schedule a reset of this workspace?'}
      description={`Nothing happens for ${overview?.coolingOffDays ?? 7} days. Any owner can cancel it until then, and every owner and admin is emailed now.`}>
      <div style={{ display: 'grid', gap: 14, marginTop: 8 }}>
        <SettingsNote tone="amber">{del
          ? 'After the wait, the workspace and everything in it is permanently deleted, after a final backup. Nobody can sign in afterwards.'
          : 'After the wait, every record is cleared, after a final backup. The workspace, its setup and the owners’ accounts stay.'}</SettingsNote>
        <SettingsInput label={`Type the workspace name to confirm: ${name}`} value={typed} onChange={setTyped} placeholder={name} maxLength={150} />
        <SettingsInput label="Reason (optional, included in the email)" value={reason} onChange={setReason} maxLength={500} />
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          <HrButton variant="ghost" onClick={close} disabled={a.schedule.isPending}>Keep the workspace</HrButton>
          <HrButton variant="danger" onClick={submit} disabled={!matches || a.schedule.isPending}>{a.schedule.isPending ? 'Scheduling…' : del ? 'Schedule deletion' : 'Schedule reset'}</HrButton>
        </div>
      </div>
    </Modal>
  )
}

const OpenRequest: React.FC<{ r: LifecycleRequest; show: Show }> = ({ r, show }) => {
  const a = useLifecycleActions()
  const confirm = useConfirmDialog()
  const noun = r.kind === 'DELETE' ? 'deletion' : 'reset'
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel the workspace ${noun}?`, body: 'Nothing is removed and the workspace carries on as before. Every owner and admin is emailed.', confirmLabel: `Cancel the ${noun}`, cancelLabel: 'Keep it scheduled' }))) return
    a.cancel.mutate(r.id, { onSuccess: () => show('ok', `The ${noun} is cancelled`, 'Every owner and admin has been emailed.'), onError: (e) => show('error', 'Not cancelled', msg(e)) })
  }
  return (
    <div style={{ ...ROW, background: '#fef2f2', border: '1px solid #fecaca' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid', gap: 4 }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{r.status === 'DUE' ? `The 7-day wait has ended; the ${noun} will be carried out soon` : `Workspace ${noun} scheduled for ${whenIst(r.scheduledFor)}`}</strong>
          <HrStatusPill tone="red">{r.status === 'DUE' ? 'Due' : 'Scheduled'}</HrStatusPill>
        </span>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>Asked by {r.requestedByEmail ?? 'an owner'} on {whenIst(r.createdAt)}{r.reason ? ` · “${r.reason}”` : ''}</span>
      </div>
      <HrButton variant="ghost" onClick={cancel} disabled={a.cancel.isPending}>{a.cancel.isPending ? 'Cancelling…' : `Cancel ${noun}`}</HrButton>
    </div>
  )
}

const List: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{title}</span>
    <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13.5, color: '#334155', lineHeight: 1.5 }}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
  </div>
)

const LifecycleSections: React.FC<{ show: Show }> = ({ show }) => {
  const q = useLifecycle(true)
  const [modal, setModal] = useState<'RESET' | 'DELETE' | null>(null)
  const o = q.data
  const open = o?.requests.find((r) => r.status === 'SCHEDULED' || r.status === 'DUE')
  const history = (o?.requests ?? []).filter((r) => r !== open)
  const ownerNote = o && !o.youAreOwner ? <SettingsNote>Only a workspace owner can schedule this. You can cancel a scheduled one.</SettingsNote> : null

  const section = (kind: 'RESET' | 'DELETE') => {
    const del = kind === 'DELETE'
    const mine = open?.kind === kind ? open : undefined
    return (
      <SettingsSection key={kind} id={del ? 'delete' : 'reset'} icon={del ? 'trash' : 'archive'} title={del ? 'Delete organisation' : 'Reset workspace'}
        summary={del
          ? `Permanently delete this workspace and everything in it. Scheduled, never immediate: ${o?.coolingOffDays ?? 7} days’ notice to every owner and admin.`
          : `Clear every record but keep the workspace, its setup and the owners’ accounts. Scheduled, never immediate: ${o?.coolingOffDays ?? 7} days’ notice to every owner and admin.`}>
        {q.isLoading ? <SkeletonBlock className="h-24 w-full rounded-xl" />
          : q.isError || !o ? <SettingsNote tone="amber">We couldn’t load this just now. {msg(q.error)}</SettingsNote>
            : (
              <>
                {mine && <OpenRequest r={mine} show={show} />}
                <SettingsGrid min={260}>
                  {del ? <List title="What is removed" items={o.deleteRemoves} /> : <List title="What is removed" items={o.resetRemoves} />}
                  {!del && <List title="What is kept" items={o.resetKeeps} />}
                </SettingsGrid>
                <SettingsNote>{`How it works: an owner types the workspace name to schedule it. For ${o.coolingOffDays} days nothing happens, and any owner can cancel it here. Every owner and admin is emailed when it’s scheduled, if it’s cancelled, and when the wait ends. It is then carried out after a final backup. Export the data first if you may need it.`}</SettingsNote>
                {!mine && (open
                  ? <SettingsNote>A workspace {open.kind === 'DELETE' ? 'deletion' : 'reset'} is already scheduled. Cancel it first to schedule a {del ? 'deletion' : 'reset'} instead.</SettingsNote>
                  : o.youAreOwner
                    ? <div><HrButton variant="danger" onClick={() => setModal(kind)}>{del ? 'Schedule deletion' : 'Schedule reset'}</HrButton></div>
                    : ownerNote)}
              </>
            )}
      </SettingsSection>
    )
  }

  return (
    <>
      {section('RESET')}
      {section('DELETE')}
      {history.length > 0 && (
        <SettingsSection id="history" icon="clock" title="Earlier requests" summary={`${history.length} earlier reset or deletion ${history.length === 1 ? 'request' : 'requests'}`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {history.map((r) => (
              <div key={r.id} style={ROW}>
                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid', gap: 4 }}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 14 }}>Workspace {r.kind === 'DELETE' ? 'deletion' : 'reset'}</strong><HrStatusPill tone="gray">{r.status === 'CANCELLED' ? 'Cancelled' : 'Carried out'}</HrStatusPill></span>
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>Asked by {r.requestedByEmail ?? 'an owner'} on {whenIst(r.createdAt)}{r.status === 'CANCELLED' ? ` · cancelled by ${r.cancelledByEmail ?? 'an owner'} on ${whenIst(r.cancelledAt)}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
      <ScheduleModal kind={modal} overview={o} onClose={() => setModal(null)} show={show} />
    </>
  )
}

export const DangerZoneSettings: React.FC<{ crumb: string; title: string; subtitle: string }> = ({ crumb, title, subtitle }) => {
  const canExport = usePermission('workspace.data.export')
  const canLifecycle = usePermission('workspace.lifecycle.manage')
  const { toast, show, dismiss } = useSettingsToast()
  const nav: SettingsNavItem[] = [
    ...(canExport ? [{ key: 'export', label: 'Export all data', state: 'none' as const }] : []),
    ...(canLifecycle ? [{ key: 'reset', label: 'Reset workspace', state: 'none' as const }, { key: 'delete', label: 'Delete organisation', state: 'none' as const }] : []),
  ]
  return (
    <SettingsPage crumb={crumb} title={title} subtitle={subtitle} nav={nav} access={canExport || canLifecycle ? 'edit' : 'none'} status="live" entity="the danger zone"
      noAccessText="Only workspace owners can export all data or reset or delete the workspace."
      dirty={false} changeCount={0} errorCount={0} saving={false} onSave={() => {}} onDiscard={() => {}} toast={toast} onDismissToast={dismiss}>
      {canExport && <ExportSection show={show} />}
      {canLifecycle && <LifecycleSections show={show} />}
    </SettingsPage>
  )
}
