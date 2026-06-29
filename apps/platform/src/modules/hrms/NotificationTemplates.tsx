import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Bell, Pencil, X } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useNotificationTemplates, useCreateNotificationTemplate,
  useUpdateNotificationTemplate, useDeleteNotificationTemplate,
  NOTIFICATION_CHANNELS,
  type NotificationChannel, type NotificationTemplate,
} from './api/useNotificationTemplate'

const CHANNEL_TONE: Record<NotificationChannel, PillTone> = {
  EMAIL: 'blue', SMS: 'teal', PUSH: 'purple', IN_APP: 'orange',
}

const fmtChannel = (c: NotificationChannel) => c === 'IN_APP' ? 'In-App'
  : c.charAt(0) + c.slice(1).toLowerCase()

interface FormState {
  name: string
  channel: NotificationChannel
  eventKey: string
  subject: string
  body: string
  active: boolean
}

const emptyForm = (): FormState => ({
  name: '', channel: 'EMAIL', eventKey: '', subject: '', body: '', active: true,
})

export const NotificationTemplates: React.FC = () => {
  const canRead = usePermission('hrms.notiftemplate.read')
  const canWrite = usePermission('hrms.notiftemplate.write')
  const { toast } = useToast()

  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data, isLoading } = useNotificationTemplates(activeCompany || undefined, 0)
  const templates = data?.content ?? []

  const create = useCreateNotificationTemplate()
  const update = useUpdateNotificationTemplate()
  const remove = useDeleteNotificationTemplate()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const setField = (patch: Partial<FormState>) => setForm((p) => ({ ...p, ...patch }))

  const stats = useMemo(() => {
    const active = templates.filter((t) => t.active).length
    const channels = new Set(templates.map((t) => t.channel)).size
    return { total: templates.length, active, channels }
  }, [templates])

  const startEdit = (t: NotificationTemplate) => {
    setEditingId(t.id)
    setForm({
      name: t.name, channel: t.channel, eventKey: t.eventKey,
      subject: t.subject ?? '', body: t.body ?? '', active: t.active,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm())
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Template name is required', 'error'); return }
    if (!form.eventKey.trim()) { toast('Event key is required', 'error'); return }
    if (!form.body.trim()) { toast('Message body is required', 'error'); return }
    const payload = {
      companyId: activeCompany || undefined,
      name: form.name.trim(),
      channel: form.channel,
      eventKey: form.eventKey.trim(),
      subject: form.subject.trim() || undefined,
      body: form.body.trim(),
      active: form.active,
    }
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, ...payload })
        toast('Template updated', 'success')
      } else {
        await create.mutateAsync(payload)
        toast('Template created', 'success')
      }
      cancelEdit()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save template', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id)
      toast('Template deleted', 'success')
      if (editingId === id) cancelEdit()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to delete template', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'
  const saving = create.isPending || update.isPending

  if (!canRead) {
    return (
      <div className="mx-auto max-w-5xl p-6 sm:p-8">
        <HrPageHeader crumb="Notifications" title="Notification Templates" subtitle="Message templates by channel and event" />
        <TableCard>
          <div className="py-14 text-center text-sm text-text-tertiary">
            You do not have access to notification templates.
          </div>
        </TableCard>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Notifications" title="Notification Templates" subtitle="Author message templates by channel and event" />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<Bell size={18} />} color="orange" value={stats.total} label="Templates" loading={isLoading} />
        <HrStatCard icon={<Bell size={18} />} color="green" value={stats.active} label="Active" loading={isLoading} />
        <HrStatCard icon={<Bell size={18} />} color="blue" value={stats.channels} label="Channels Used" loading={isLoading} />
      </div>

      {companies.length > 1 && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className={`${inputCls} mb-4 sm:w-72`}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      {canWrite && (
        <div className="mb-5 rounded-2xl border border-border-default bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">
              {editingId ? 'Edit template' : 'New template'}
            </h3>
            {editingId && (
              <button onClick={cancelEdit} className="flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary">
                <X size={13} /> Cancel
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Name *</label>
              <input value={form.name} onChange={(e) => setField({ name: e.target.value })} placeholder="e.g. Leave approved — email" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Channel *</label>
              <select value={form.channel} onChange={(e) => setField({ channel: e.target.value as NotificationChannel })} className={inputCls}>
                {NOTIFICATION_CHANNELS.map((c) => <option key={c} value={c}>{fmtChannel(c)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Event key *</label>
              <input value={form.eventKey} onChange={(e) => setField({ eventKey: e.target.value })} placeholder="e.g. leave.approved" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Subject</label>
              <input value={form.subject} onChange={(e) => setField({ subject: e.target.value })} placeholder="Optional (e.g. email subject line)" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text-secondary">Body *</label>
              <textarea value={form.body} onChange={(e) => setField({ body: e.target.value })} rows={4} placeholder="Message body — use {{placeholders}} for dynamic values" className={inputCls} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={form.active} onChange={(e) => setField({ active: e.target.checked })} className="h-4 w-4 rounded border-border-default text-[#FF9D00] focus:ring-[#FF9D00]/30" />
              Active
            </label>
            <HrButton onClick={handleSave} disabled={saving}>
              {editingId ? <Pencil size={15} /> : <Plus size={15} />}
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Template'}
            </HrButton>
          </div>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Channel</th>
              <th>Event</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canWrite ? 5 : 4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : templates.length === 0 ? (
              <tr><td colSpan={canWrite ? 5 : 4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No notification templates yet</p><p className="mt-1 text-xs text-text-tertiary">{canWrite ? 'Use the form above to author your first template.' : 'Templates will appear here once created.'}</p></td></tr>
            ) : templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="font-medium text-text-primary">{t.name}</div>
                  {t.subject && <div className="text-xs text-text-tertiary">{t.subject}</div>}
                </td>
                <td><HrStatusPill tone={CHANNEL_TONE[t.channel]}>{fmtChannel(t.channel)}</HrStatusPill></td>
                <td className="font-mono text-xs text-text-secondary">{t.eventKey}</td>
                <td><HrStatusPill tone={t.active ? 'ok' : 'gray'}>{t.active ? 'Active' : 'Inactive'}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => startEdit(t)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FFF3DD] hover:text-[#C16E00]" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
