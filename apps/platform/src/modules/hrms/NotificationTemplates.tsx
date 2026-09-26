// Notification templates (/hrms/settings/notifications, in HRMS settings), on the module kit.
// Templates are stored per company, channel and event. When a notification
// goes out, the sender uses the person's company's active template for that
// event and channel ({{placeholders}} filled in), or the built-in wording.
// The event is picked from GET /v1/notiftemplate/events, which also lists
// each event's placeholders and built-in wording; the server refuses unknown
// events, channels and placeholders.
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
  useNotificationEvents, findNotificationEvent,
  NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationTemplate, type NotificationEvent,
} from './api/useNotificationTemplate'

const CHANNEL_TONE: Record<NotificationChannel, PillTone> = { EMAIL: 'blue', SMS: 'teal', PUSH: 'purple', IN_APP: 'orange' }
const fmtChannel = (c: NotificationChannel) => (c === 'IN_APP' ? 'In-app' : c === 'SMS' ? 'SMS' : c.charAt(0) + c.slice(1).toLowerCase())
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
interface FormState { name: string; channel: NotificationChannel; eventKey: string; subject: string; body: string; active: boolean }
const emptyForm = (): FormState => ({ name: '', channel: 'IN_APP', eventKey: '', subject: '', body: '', active: true })
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g
const usedPlaceholders = (...texts: string[]) => Array.from(new Set(texts.flatMap((t) => Array.from(t.matchAll(PLACEHOLDER), (m) => m[1]))))
const channelsFor = (ev?: NotificationEvent): NotificationChannel[] => (ev ? ev.templateChannels : NOTIFICATION_CHANNELS)
/** A template is used only for a known event, on a channel that event is sent on. */
const inUse = (t: NotificationTemplate, ev?: NotificationEvent) => !!ev && (ev.templateChannels as string[]).includes(t.channel)

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
  const eventsQuery = useNotificationEvents(canRead || canWrite)
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data])
  // Events a template can be written for, grouped as the picker shows them.
  const pickerGroups = useMemo(() => {
    const groups = new Map<string, NotificationEvent[]>()
    for (const e of events) if (e.templateChannels.length) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
    return Array.from(groups.entries())
  }, [events])
  const create = useCreateNotificationTemplate()
  const update = useUpdateNotificationTemplate()
  const remove = useDeleteNotificationTemplate()
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null)
  const setField = (patch: Partial<FormState>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
  const saving = create.isPending || update.isPending
  const stats = useMemo(() => ({ active: templates.filter((t) => t.active).length, channels: new Set(templates.map((t) => t.channel)).size }), [templates])
  const pageNote = (data?.totalPages ?? 1) > 1 ? 'On this page' : undefined

  const startEdit = (t: NotificationTemplate) => {
    const ev = findNotificationEvent(events, t.eventKey)
    setEditing({ id: t.id, form: { name: t.name, channel: t.channel, eventKey: ev?.key ?? t.eventKey, subject: t.subject ?? '', body: t.body ?? '', active: t.active } })
  }
  const editingEvent = editing ? findNotificationEvent(events, editing.form.eventKey) : undefined
  /** Built-in wording for an event + channel, used to start a new template. */
  const builtIn = (ev: NotificationEvent | undefined, channel: NotificationChannel) => ev?.defaults[channel as keyof NotificationEvent['defaults']]
  const pickEvent = (key: string) => setEditing((e) => {
    if (!e) return e
    const ev = findNotificationEvent(events, key)
    const allowed = channelsFor(ev)
    const channel = allowed.includes(e.form.channel) ? e.form.channel : allowed[0] ?? e.form.channel
    const def = builtIn(ev, channel)
    const untouched = !e.form.subject.trim() && !e.form.body.trim()
    return { ...e, form: { ...e.form, eventKey: key, channel,
      name: e.form.name.trim() || (ev ? `${ev.label} (${fmtChannel(channel)})` : e.form.name),
      ...(untouched && def ? { subject: def.subject ?? '', body: def.body ?? '' } : {}) } }
  })
  const pickChannel = (channel: NotificationChannel) => setEditing((e) => {
    if (!e) return e
    const ev = findNotificationEvent(events, e.form.eventKey)
    const prev = builtIn(ev, e.form.channel)
    const next = builtIn(ev, channel)
    // Follow the built-in wording while the admin hasn't changed it.
    const untouched = (!e.form.subject.trim() && !e.form.body.trim()) || (prev && e.form.subject === (prev.subject ?? '') && e.form.body === (prev.body ?? ''))
    return { ...e, form: { ...e.form, channel, ...(untouched && next ? { subject: next.subject ?? '', body: next.body ?? '' } : {}) } }
  })
  const applyBuiltIn = () => {
    const def = builtIn(editingEvent, editing?.form.channel ?? 'IN_APP')
    if (def) setField({ subject: def.subject ?? '', body: def.body ?? '' })
  }
  const save = async () => {
    if (!editing) return
    const f = editing.form
    if (!f.name.trim()) { show('Name the template', true); return }
    if (!f.eventKey.trim()) { show('Pick the notification it’s for', true); return }
    if (!f.body.trim()) { show('Write the message', true); return }
    const ev = findNotificationEvent(events, f.eventKey)
    if (ev) {
      const allowed = new Set(ev.placeholders.map((p) => p.name))
      const unknown = usedPlaceholders(f.subject, f.body).filter((n) => !allowed.has(n))
      if (unknown.length) { show('Unknown placeholder', true, `${unknown.map((n) => `{{${n}}}`).join(', ')} can’t be used for “${ev.label}”. Use the ones listed under the message.`); return }
      // Always-sent emails hand over a link (set / reset a password); without it people are locked out.
      const inBody = new Set(usedPlaceholders(f.body))
      const missing = ev.essential && f.channel === 'EMAIL' ? ev.placeholders.filter((p) => p.link && !inBody.has(p.name)) : []
      if (missing.length) { show('The link is missing', true, `Keep ${missing.map((p) => `{{${p.name}}}`).join(' and ')} in the message, or people can’t act on this email.`); return }
    }
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
    <ModulePage crumb="HRMS settings" title="Notification templates" subtitle="Message wording by channel and event."
      actions={<>
        {companies.length > 1 && (
          <select aria-label="Company" value={activeCompany} onChange={(e) => { setCompanyId(e.target.value); setPage(0) }} className="ut-select ut-select-sm w-56">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {canWrite && <HrButton onClick={() => setEditing({ id: null, form: emptyForm() })}><Plus size={15} /> New template</HrButton>}
      </>}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <Note>When a notification goes out, the active template for the person’s company, event and channel is used, with names, dates and other details filled into its {'{{placeholders}}'}. With no active template, the built-in wording is sent. Changes apply to the next message.</Note>
        {!canRead ? <State kind="empty" icon="lock" title="Can’t list templates" description={canWrite ? 'Your role can add templates but not read them. Ask an admin for read access to see the list.' : 'Ask an admin if you should see notification templates.'} />
          : <>
            {isLoading ? <State kind="loading" height={96} /> : !isError && <StatRow tiles={[
              { icon: 'inbox', color: 'orange', label: 'Templates', value: String(data?.totalElements ?? 0), sub: 'In this company' },
              { icon: 'checkCircle', color: 'green', label: 'Active', value: String(stats.active), sub: pageNote || 'Switched on' },
              { icon: 'list', color: 'blue', label: 'Channels used', value: String(stats.channels), sub: pageNote || 'Email, push, in-app' },
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
                              <td className="hidden sm:table-cell">{(() => {
                                const ev = findNotificationEvent(events, t.eventKey)
                                return ev
                                  ? <><div className="text-text-primary">{ev.label}</div><div className="font-mono text-xs text-text-tertiary">{ev.key}</div></>
                                  : <div className="font-mono text-xs text-text-secondary">{t.eventKey}</div>
                              })()}</td>
                              <td>{eventsQuery.isSuccess && !inUse(t, findNotificationEvent(events, t.eventKey))
                                ? <span title="No notification is sent for this event on this channel, so this template is never used. Edit it to pick a notification from the list."><HrStatusPill tone="gray">Not used</HrStatusPill></span>
                                : <HrStatusPill tone={t.active ? 'ok' : 'gray'}>{t.active ? 'Active' : 'Off'}</HrStatusPill>}</td>
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
            <div>
              <label className={label} htmlFor="nt-event">Notification</label>
              <select id="nt-event" value={editing.form.eventKey} onChange={(e) => pickEvent(e.target.value)} className="ut-select" disabled={eventsQuery.isLoading}>
                <option value="">{eventsQuery.isLoading ? 'Loading notifications…' : 'Choose the notification this wording is for'}</option>
                {pickerGroups.map(([group, list]) => (
                  <optgroup key={group} label={group}>{list.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}</optgroup>
                ))}
                {editing.form.eventKey && !editingEvent && <option value={editing.form.eventKey}>{editing.form.eventKey} (not a notification that is sent)</option>}
              </select>
              {eventsQuery.isError && <p className="mt-1.5 text-xs text-text-tertiary">The list of notifications couldn’t be loaded. Close this and try again.</p>}
              {editingEvent && <p className="mt-1.5 text-xs text-text-tertiary">{editingEvent.description} Sent to: {editingEvent.audience}. Key: <span className="font-mono">{editingEvent.key}</span></p>}
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div><label className={label} htmlFor="nt-channel">Channel</label><select id="nt-channel" value={editing.form.channel} onChange={(e) => pickChannel(e.target.value as NotificationChannel)} className="ut-select">{(channelsFor(editingEvent).includes(editing.form.channel) ? channelsFor(editingEvent) : [editing.form.channel, ...channelsFor(editingEvent)]).map((c) => <option key={c} value={c}>{fmtChannel(c)}</option>)}</select></div>
              <div><label className={label} htmlFor="nt-name">Name</label><input id="nt-name" value={editing.form.name} onChange={(e) => setField({ name: e.target.value })} placeholder="e.g. Leave approved (email)" className="ut-input" /></div>
            </div>
            {editingEvent?.essential && editing.form.channel === 'EMAIL' && <Note tone="amber">This email is always sent, even to people who switched email off, because it’s how they get into their account or receive something HR sent on purpose.{editingEvent.placeholders.some((p) => p.link) && <> Its {'{{…Link}}'} placeholder must stay in the message: without it people can’t act on the email, so saving is refused.</>}</Note>}
            <div><label className={label} htmlFor="nt-subject">{editing.form.channel === 'EMAIL' ? 'Subject' : 'Title'}</label><input id="nt-subject" value={editing.form.subject} onChange={(e) => setField({ subject: e.target.value })} placeholder={editing.form.channel === 'EMAIL' ? 'Leave blank to keep the built-in subject' : 'Leave blank to keep the built-in title'} className="ut-input" /></div>
            <div>
              <label className={label} htmlFor="nt-body">Message</label>
              <textarea id="nt-body" value={editing.form.body} onChange={(e) => setField({ body: e.target.value })} rows={6} placeholder="Use {{placeholders}} for names, dates and so on" className="ut-input resize-y" />
              {editing.form.channel === 'EMAIL' && <p className="mt-1.5 text-xs text-text-tertiary">Plain text. A blank line starts a new paragraph, and links such as the invitation link become clickable.</p>}
            </div>
            {editingEvent && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-text-secondary">You can use</span>
                  {builtIn(editingEvent, editing.form.channel) && <HrButton size="sm" variant="ghost" onClick={applyBuiltIn}>Start from the built-in wording</HrButton>}
                </div>
                {editingEvent.placeholders.length === 0
                  ? <p className="text-xs text-text-tertiary">This notification has no placeholders.</p>
                  : <ul className="space-y-1 text-xs text-text-secondary">{editingEvent.placeholders.map((p) => <li key={p.name}><span className="font-mono text-text-primary">{`{{${p.name}}}`}</span> — {p.description}</li>)}</ul>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.form.active} onChange={(e) => setField({ active: e.target.checked })} className="h-4 w-4 accent-[#059669]" /> Active (turn off to go back to the built-in wording)</label>
          </div>
        </HrDrawer>
      )}
      {node}
    </ModulePage>
  )
}
