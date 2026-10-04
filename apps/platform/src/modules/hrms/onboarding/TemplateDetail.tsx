// One checklist template (/hrms/onboarding/templates/:id) on the redesign kit (P-HIRE;
// prototype PgTalent h-onb, the template view): its tasks in order, and for template writers
// edit / add / delete / move up and down (PUT /templates/{id}/tasks/order). A task's owner is
// picked from the workspace's roles (GET /v1/onboarding/owner-roles). A task can fall due
// before the joining day, on it, or after it (its offset in days).
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, Callout, CellActions, CellStack, KeyValueGrid, PageFrame, PageHeader, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, Toggle, useToast } from '@/design/kit/overlays'
import { useTemplate, useCreateTemplateTask, useDeleteTemplateTask, useUpdateTemplate, useReorderTemplateTasks, useOwnerRoles } from './api/useOnboarding'
import type { OnboardingTask, OnboardingTemplate } from './api/useOnboarding'
import { dueOffsetLabel, roleLabel } from './onboardingModel'
import '../hiring/hiring.css'

export { roleLabel }

const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'

function EditTemplatePanel({ template, onClose }: { template: OnboardingTemplate; onClose: () => void }) {
  const toast = useToast()
  const update = useUpdateTemplate(template.id)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [active, setActive] = useState(template.active)
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({ companyId: template.companyId, name: name.trim(), description: description.trim() || undefined, designationId: template.designationId, departmentId: template.departmentId, active })
      toast.success('Template saved'); onClose()
    } catch (err) { toast.error('Couldn’t save the template', { detail: errText(err) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={520} busy={update.isPending} closeLabel="Close panel" title="Edit template"
      footer={<><PanelButton size="lg" onClick={onClose} disabled={update.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={update.isPending} disabled={!name.trim()} onClick={() => submit()}>Save changes</PanelButton></>}>
      <form id="tpl-edit" onSubmit={submit} noValidate>
        <FieldGrid columns={1}>
          <Input id="tpl-edit-name" label="Template name" required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          <Textarea id="tpl-edit-desc" label="Description" rows={3} value={description} maxLength={2000} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
          <Toggle checked={active} onChange={setActive} label="Active" description="Offered when starting onboarding." />
        </FieldGrid>
      </form>
    </SidePanel>
  )
}

type DueWhen = 'before' | 'on' | 'after'

function AddTaskPanel({ templateId, nextSeq, onClose }: { templateId: string; nextSeq: number; onClose: () => void }) {
  const toast = useToast()
  const create = useCreateTemplateTask(templateId)
  const roles = useOwnerRoles()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // The offset is days from the joining day: before it (negative), on it (0) or after it.
  const [when, setWhen] = useState<DueWhen>('after')
  const [days, setDays] = useState('1')
  const [ownerRole, setOwnerRole] = useState('')
  const [required, setRequired] = useState(true)
  const [titleError, setTitleError] = useState('')
  const n = Math.max(1, Math.min(365, parseInt(days, 10) || 1))
  const offset = when === 'on' ? 0 : when === 'before' ? -n : n
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim()) { setTitleError('Name the task'); return }
    try {
      await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined, dueOffsetDays: offset, ownerRole: ownerRole.trim() || null, required, sequenceNo: nextSeq })
      toast.success('Task added'); onClose()
    } catch (err) { toast.error('Couldn’t add the task', { detail: errText(err) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={560} busy={create.isPending} closeLabel="Close panel" title="Add a task"
      sub="It shows on the checklist of every new hire who starts on this template from now on."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={create.isPending} onClick={() => submit()}>Add task</PanelButton></>}>
      <form id="tpl-task" onSubmit={submit} noValidate className="hi-stack">
        <FieldGrid columns={2}>
          <Input id="task-title" label="Task" required full value={title} maxLength={200} placeholder="e.g. Complete IT setup" error={titleError || undefined}
            onChange={(e) => { setTitle(e.target.value); setTitleError('') }} />
          <Textarea id="task-desc" label="Description" full rows={2} value={description} maxLength={2000} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
          <Select id="task-when" label="Due" value={when} onChange={(e) => setWhen(e.target.value as DueWhen)}
            options={[{ value: 'before', label: 'Before joining' }, { value: 'on', label: 'On the joining day' }, { value: 'after', label: 'After joining' }]} />
          {when !== 'on'
            ? <Input id="task-due" label={when === 'before' ? 'Days before joining' : 'Due (days after joining)'} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} hint={dueOffsetLabel(offset)} />
            : <span aria-hidden="true" />}
          <Select id="task-owner" label="Owner role" full value={ownerRole} disabled={roles.isLoading} onChange={(e) => setOwnerRole(e.target.value)}
            placeholder={roles.isLoading ? 'Loading roles…' : 'No owner role'} options={(roles.data ?? []).map((r) => ({ value: r.code, label: r.name }))}
            hint={roles.error ? undefined : 'The role responsible for this task. It shows on every new hire’s checklist.'}
            error={roles.error ? `The workspace’s roles couldn’t be loaded: ${errText(roles.error)}` : undefined} />
          <Toggle full checked={required} onChange={setRequired} label="Required" description="It can’t be skipped." />
        </FieldGrid>
      </form>
    </SidePanel>
  )
}

export const TemplateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<OnboardingTask | null>(null)
  const canWrite = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const { data: template, isLoading, error, refetch, isFetching } = useTemplate(id!)
  const tasks = [...(template?.tasks ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo)
  const required = tasks.filter((t) => t.required).length
  const reorder = useReorderTemplateTasks(id!)
  const del = useDeleteTemplateTask(id!)
  const move = async (index: number, dir: -1 | 1) => {
    const ids = tasks.map((t) => t.id)
    const to = index + dir
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    try { await reorder.mutateAsync(ids); toast.success('Order saved') } catch (e) { toast.error('Couldn’t change the order', { detail: errText(e) }) }
  }
  const remove = async () => {
    if (!deleting) return
    try { await del.mutateAsync(deleting.id); toast.success('Task deleted', { detail: deleting.title }); setDeleting(null) }
    catch (e) { toast.error('Couldn’t delete the task', { detail: errText(e) }) }
  }
  const columns: TableColumn<OnboardingTask>[] = [
    { key: 'n', header: '#', width: 48, render: (_t, i) => <span className="hi-num hi-muted">{i + 1}</span> },
    { key: 'task', header: 'Task', primary: true, width: '34%', render: (t) => <CellStack primary={t.title} secondary={t.description || undefined} /> },
    { key: 'due', header: 'Due', render: (t) => dueOffsetLabel(t.dueOffsetDays) },
    { key: 'owner', header: 'Owner role', render: (t) => (t.ownerRole ? roleLabel(t.ownerRole) : '—') },
    { key: 'required', header: 'Required', render: (t) => <StatusPill tone={t.required ? 'success' : 'neutral'}>{t.required ? 'Required' : 'Optional'}</StatusPill> },
    ...(canWrite ? [{
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (t: OnboardingTask, i: number) => (
        <CellActions>
          <Button size={30} variant="secondary" disabled={reorder.isPending || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.title} up`}>Move up</Button>
          <Button size={30} variant="secondary" disabled={reorder.isPending || i === tasks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.title} down`}>Move down</Button>
          <Button size={30} variant="danger-outline" disabled={del.isPending} onClick={() => setDeleting(t)} aria-label={`Delete task ${t.title}`}>Delete</Button>
        </CellActions>
      ),
    }] : []),
  ]
  return (
    <PageFrame label="Checklist template" className="hi-page">
      <PageHeader eyebrow="Onboarding · Checklist template" title={template?.name || 'Checklist template'}
        sub={template ? `${template.description ? `${template.description} · ` : ''}${template.active ? 'Active: offered when starting onboarding' : 'Archived: not offered for new hires'}` : undefined}
        actions={<>
          <Button variant="secondary" size={40} icon="chevronLeft" onClick={() => navigate('/hrms/onboarding/instances?view=templates')}>All templates</Button>
          {template && canWrite && <Button variant="secondary" size={40} icon="pencil" onClick={() => setEditOpen(true)}>Edit</Button>}
        </>} />
      {error ? <Section title="Checklist template" error={error} onRetry={() => refetch()} retrying={isFetching}>{null}</Section>
        : !isLoading && !template ? <Section title="Checklist template" empty={{ title: 'Template not found', icon: 'list' }}>{null}</Section>
          : (
            <>
              <Section title="Overview" body="tight" loading={isLoading} skeleton="text">
                {template && (
                  <KeyValueGrid items={[
                    { key: 'status', label: 'Status', value: <StatusPill tone={template.active ? 'success' : 'neutral'}>{template.active ? 'Active' : 'Archived'}</StatusPill> },
                    { key: 'tasks', label: 'Tasks', value: String(tasks.length) },
                    { key: 'required', label: 'Required', value: String(required) },
                    { key: 'optional', label: 'Optional', value: String(tasks.length - required) },
                  ]} />
                )}
              </Section>
              <Section title="Tasks, in order" body="flush" loading={isLoading} skeleton="table"
                action={template && canWrite ? { label: 'Add task', icon: 'plus', onClick: () => setAddOpen(true) } : undefined}
                empty={template && tasks.length === 0 ? { title: 'No tasks yet', icon: 'list', hint: canWrite ? 'Add the first task to build the checklist.' : 'This template has no tasks yet.' } : undefined}
                footer={canWrite && tasks.length > 1 ? <p className="hi-small" style={{ padding: '12px 20px' }}>New onboardings follow this order. Onboardings that already started keep the order they began with.</p> : undefined}>
                <Table label="Tasks, in order" columns={columns} rows={tasks} rowKey={(t) => t.id} mobile="cards" />
              </Section>
              {!canWrite && template && <Callout tone="neutral">Only people who manage checklist templates can change this one.</Callout>}
            </>
          )}
      {addOpen && template && <AddTaskPanel templateId={template.id} nextSeq={(tasks.at(-1)?.sequenceNo ?? 0) + 1} onClose={() => setAddOpen(false)} />}
      {editOpen && template && <EditTemplatePanel template={template} onClose={() => setEditOpen(false)} />}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} busy={del.isPending} icon="trash" tone="danger" title={`Delete “${deleting?.title ?? ''}” from this template?`}
        sub="Onboardings already started keep their copy."
        footer={<><PanelButton onClick={() => setDeleting(null)} disabled={del.isPending}>Keep it</PanelButton><PanelButton variant="danger" busy={del.isPending} onClick={remove}>Delete</PanelButton></>} />
    </PageFrame>
  )
}
