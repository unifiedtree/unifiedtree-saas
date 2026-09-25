// Notification templates (/hrms/notification-templates), on the module kit.
// Templates are stored per company, channel and event key. Nothing in the
// sending path reads them yet (notifications use their built-in wording), so
// the page says that plainly instead of implying edits change messages.
//   read: hrms.notiftemplate.read · add / edit / delete: hrms.notiftemplate.write
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { HrPagination } from '@/shared/components/HrPagination'
import { HrButton, HrStatusPill, TableCard, HrDrawer, type PillTone } from '@/shared/components/hr'
import { ModulePage, StatRow, State, Note, SubHeading, useDesignToast } from '@/design/module/ModuleKit'
import { useCompanies } from './api/useOrg'
import {
  useNotificationTemplates, useCreateNotificationTemplate, useUpdateNotificationTemplate, useDeleteNotificationTemplate,
  NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationTemplate,
} from './api/useNotificationTemplate'

const CHANNEL_TONE: Record<NotificationChannel, PillTone> = { EMAIL: 'blue', SMS: 'teal', PUSH: 'purple', IN_APP: 'orange' }
const fmtChannel = (c: NotificationChannel) => (c === 'IN_APP' ? 'In-app' : c === 'SMS' ? 'SMS' : c.charAt(0) + c.slice(1).toLowerCase())
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
interface FormState { name: string; channel: NotificationChannel; eventKey: string; subject: string; body: string; active: boolean }
const emptyForm = (): FormState => ({ name: '', channel: 'EMAIL', eventKey: '', subject: '', body: '', active: true })

export const NotificationTemplates: React.FC = () => {
  const canRead = usePermission('hrms.notiftemplate.read')
  const canWrite = usePermission('hrms.notiftemplate.write')
  const { show, node } = useDesignToast()
  const confirm = useConfirmDialog()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, error, refetch } = useNotificationTemplates(activeCompany || undefined, page, canRead)
  const templates = useMemo(() => data?.content ?? [], [data])
  const create = useCreateNotificationTemplate()
  const update = useUpdateNotificationTemplate()
  const remove = useDeleteNotificationTemplate()
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null)
  const setField = (patch: Partial<FormState>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
  const saving = create.isPending || update.isPending
  const stats = useMemo(() => ({ active: templates.filter((t) => t.active).length, channels: new Set(templates.map((t) => t.channel)).size }), [templates])
  const pageNote = (data?.totalPages ?? 1) > 1 ? 'On this page' : undefined

  const startEdit = (t: NotificationTemplate) => setEditing({ id: t.id, form: { name: t.name, channel: t.channel, eventKey: t.eventKey, subject: t.subject ?? '', body: t.body ?? '', active: t.active } })
  const save = async () => {
    if (!editing) return
    const f = editing.form
    if (!f.name.trim()) { show('Name the template', true); return }
    if (!f.eventKey.trim()) { show('Add the event key it’s for', true); return }
    if (!f.body.trim()) { show('Write the message', true); return }
    const payload = { companyId: activeCompany || undefined, name: f.name.trim(), channel: f.channel, eventKey: f.eventKey.trim(), subject: f.subject.trim() || undefined, body: f.body.trim(), active: f.active }
    try {
      if (editing.id) { await update.mutateAsync({ id: editing.id, ...payload }); show('Template saved') } else { await create.mutateAsync(payload); show('Template added') }
      setEditing(null)
    } catch (e) { show('Couldn’t save the template', true, (e as Error)?.message) }
  }
  const onDelete = async (t: NotificationTemplate) => {
    const ok = await confirm({ title: `Delete “${t.name}”?`, body: 'This can’t be undone.', confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try { await remove.mutateAsync(t.id); show('Template deleted') } catch (e) { show('Couldn’t delete the template', true, (e as Error)?.message) }
  }

  return (
    <ModulePage crumb="HR setup" title="Notification templates" subtitle="Message wording by channel and event."
      actions={<>
        {companies.length > 1 && (
          <select aria-label="Company" value={activeCompany} onChange={(e) => { setCompanyId(e.target.value); setPage(0) }} className="ut-select ut-select-sm w-56">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {canWrite && <HrButton onClick={() => setEditing({ id: null, form: emptyForm() })}><Plus size={15} /> New template</HrButton>}
      </>}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <Note tone="amber">Templates are saved, but notifications still use their built-in wording. Editing a template here doesn’t change any message yet.</Note>
        {!canRead ? <State kind="empty" icon="lock" title="Can’t list templates" description={canWrite ? 'Your role can add templates but not read them. Ask an admin for read access to see the list.' : 'Ask an admin if you should see notification templates.'} />
          : <>
            {isLoading ? <State kind="loading" height={96} /> : !isError && <StatRow tiles={[
              { icon: 'inbox', color: 'orange', label: 'Templates', value: String(data?.totalElements ?? 0), sub: 'In this company' },
              { icon: 'checkCircle', color: 'green', label: 'Active', value: String(stats.active), sub: pageNote || 'Switched on' },
              { icon: 'list', color: 'blue', label: 'Channels used', value: String(stats.channels), sub: pageNote || 'Email, SMS, push, in-app' },
            ]} />}
            <SubHeading>Templates</SubHeading>
            {isError ? <State kind="error" title="Couldn’t load templates" description={(error as Error)?.message} onRetry={() => refetch()} />
              : isLoading ? <State kind="loading" height={200} />
                : templates.length === 0 ? <State kind="empty" icon="inbox" title="No templates yet" description={canWrite ? 'Use “New template” to write the first one.' : 'Templates an admin writes appear here.'} />
                  : (
                    <TableCard footer={(data?.totalPages ?? 0) > 1 ? <HrPagination page={page} pageSize={20} totalElements={data?.totalElements ?? 0} totalPages={data?.totalPages ?? 0} onPageChange={setPage} /> : undefined}>
                      <table className="hr-table">
                        <thead><tr><th>Template</th><th>Channel</th><th className="hidden sm:table-cell">Event</th><th>Status</th>{canWrite && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                        <tbody>
                          {templates.map((t) => (
                            <tr key={t.id}>
                              <td><div className="font-semibold text-text-primary">{t.name}</div>{t.subject && <div className="text-xs text-text-tertiary">{t.subject}</div>}</td>
                              <td><HrStatusPill tone={CHANNEL_TONE[t.channel] ?? 'gray'}>{fmtChannel(t.channel)}</HrStatusPill></td>
                              <td className="hidden sm:table-cell font-mono text-xs text-text-secondary">{t.eventKey}</td>
                              <td><HrStatusPill tone={t.active ? 'ok' : 'gray'}>{t.active ? 'Active' : 'Off'}</HrStatusPill></td>
                              {canWrite && (
                                <td>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <HrButton size="sm" variant="ghost" onClick={() => startEdit(t)} aria-label={`Edit template ${t.name}`}>Edit</HrButton>
                                    <HrButton size="sm" variant="ghost" onClick={() => onDelete(t)} aria-label={`Delete template ${t.name}`}>Delete</HrButton>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableCard>
                  )}
          </>}
      </div>
      {editing && (
        <HrDrawer title={editing.id ? 'Edit template' : 'New template'} onClose={() => { if (!saving) setEditing(null) }}
          footer={<><HrButton variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</HrButton><HrButton onClick={save} disabled={saving}>{saving ? 'Saving…' : editing.id ? 'Save template' : 'Add template'}</HrButton></>}>
          <div className="space-y-4">
            <div><label className={label} htmlFor="nt-name">Name</label><input id="nt-name" value={editing.form.name} onChange={(e) => setField({ name: e.target.value })} placeholder="e.g. Leave approved (email)" className="ut-input" /></div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div><label className={label} htmlFor="nt-channel">Channel</label><select id="nt-channel" value={editing.form.channel} onChange={(e) => setField({ channel: e.target.value as NotificationChannel })} className="ut-select">{NOTIFICATION_CHANNELS.map((c) => <option key={c} value={c}>{fmtChannel(c)}</option>)}</select></div>
              <div><label className={label} htmlFor="nt-event">Event key</label><input id="nt-event" value={editing.form.eventKey} onChange={(e) => setField({ eventKey: e.target.value })} placeholder="e.g. leave.approved" className="ut-input font-mono" /></div>
            </div>
            <div><label className={label} htmlFor="nt-subject">Subject</label><input id="nt-subject" value={editing.form.subject} onChange={(e) => setField({ subject: e.target.value })} placeholder="Optional; used for email" className="ut-input" /></div>
            <div><label className={label} htmlFor="nt-body">Message</label><textarea id="nt-body" value={editing.form.body} onChange={(e) => setField({ body: e.target.value })} rows={5} placeholder="Use {{placeholders}} for names, dates and so on" className="ut-input resize-y" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.form.active} onChange={(e) => setField({ active: e.target.checked })} className="h-4 w-4 accent-[#059669]" /> Active</label>
          </div>
        </HrDrawer>
      )}
      {node}
    </ModulePage>
  )
}
