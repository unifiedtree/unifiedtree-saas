// One checklist template (/hrms/onboarding/templates/:id) on the redesign kit (prototype PgTalent
// "Checklist template"): its tasks in order, and for template writers edit / add / delete / move up
// and down (PUT /templates/{id}/tasks/order). A task's owner is picked from the workspace's roles
// (GET /v1/onboarding/owner-roles). A task can be due before the joining day (a negative offset),
// on it, or some days after.
import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, KeyValueGrid, PageFrame, PageHeader, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Dialog, Input, PanelButton, Select, SidePanel, Textarea, Toggle, useToast } from '@/design/kit/overlays'
import { useTemplate, useCreateTemplateTask, useDeleteTemplateTask, useUpdateTemplate, useReorderTemplateTasks, useOwnerRoles } from './api/useOnboarding'
import type { OnboardingTask, OnboardingTemplate } from './api/useOnboarding'
import { dueLabel, offsetOf, roleLabel } from './onboardingModel'
import './onboarding.css'

// Kept for callers of the old helper.
export { roleLabel }

function EditTemplatePanel({ template, open, onClose }: { template: OnboardingTemplate; open: boolean; onClose: () => void }) {
  const update = useUpdateTemplate(template.id)
  const toast = useToast()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [active, setActive] = useState(template.active)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setName(template.name); setDescription(template.description ?? ''); setActive(template.active); setError('')
  }, [open, template])
  const close = () => { if (!update.isPending) onClose() }
  const submit = async () => {
    if (!name.trim()) return
    setError('')
    try {
      await update.mutateAsync({ companyId: template.companyId, name: name.trim(), description: description.trim() || undefined, designationId: template.designationId, departmentId: template.departmentId, active })
      toast.success('Template saved'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t save the template.')) }
  }
  return (
    <SidePanel open={open} onClose={close} busy={update.isPending} width={480} title="Edit template"
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={update.isPending} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={update.isPending} blockedReason={!name.trim() ? 'Give the template a name' : null} onClick={submit}>Save changes</PanelButton>
      </>}>
      <form className="onb-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Input id="tpl-edit-name" label="Template name" required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <Textarea id="tpl-edit-desc" label="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <Toggle checked={active} onChange={setActive} label="Active: offered when starting onboarding" description="Archived templates stay on the onboardings that already use them." />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </form>
    </SidePanel>
  )
}

function AddTaskPanel({ templateId, nextSeq, open, onClose }: { templateId: string; nextSeq: number; open: boolean; onClose: () => void }) {
  const create = useCreateTemplateTask(templateId)
  const roles = useOwnerRoles(open)
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [when, setWhen] = useState<'before' | 'on' | 'after'>('after')
  const [days, setDays] = useState(1)
  const [ownerRole, setOwnerRole] = useState('')
  const [required, setRequired] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setTitle(''); setDescription(''); setWhen('after'); setDays(1); setOwnerRole(''); setRequired(true); setError('')
  }, [open])
  const close = () => { if (!create.isPending) onClose() }
  const submit = async () => {
    if (!title.trim()) return
    setError('')
    try {
      await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined, dueOffsetDays: offsetOf(when, days), ownerRole: ownerRole.trim() || null, required, sequenceNo: nextSeq })
      toast.success('Task added'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t add the task.')) }
  }
  return (
    <SidePanel open={open} onClose={close} busy={create.isPending} width={520} title="Add a task"
      sub="It shows on the checklist of every new hire who starts on this template from now on."
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={create.isPending} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={create.isPending} blockedReason={!title.trim() ? 'Name the task' : null} onClick={submit}>Add task</PanelButton>
      </>}>
      <form className="onb-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Input id="task-title" label="Task" required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete IT setup" />
        <Textarea id="task-desc" label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <div className="onb-wiz-grid">
          <Select id="task-when" label="Due" value={when} onChange={(e) => setWhen(e.target.value as 'before' | 'on' | 'after')}
            options={[{ value: 'before', label: 'Before joining' }, { value: 'on', label: 'On the joining day' }, { value: 'after', label: 'After joining' }]} />
          {when !== 'on' && (
            <Input id="task-due" label={when === 'before' ? 'Days before joining' : 'Days after joining'} type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(Number(e.target.value))} />
          )}
        </div>
        <Select id="task-owner" label="Owner role" value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} disabled={roles.isLoading}
          hint={roles.error ? undefined : 'The role responsible for this task. It shows on every new hire’s checklist.'}
          options={[{ value: '', label: roles.isLoading ? 'Loading roles…' : 'No owner role' }, ...(roles.data ?? []).map((r) => ({ value: r.code, label: r.name }))]} />
        {roles.error && <Callout tone="danger" icon="alert">{`The workspace’s roles couldn’t be loaded: ${errorText(roles.error, 'try again in a moment')}`}</Callout>}
        <Toggle checked={required} onChange={setRequired} label="Required: it can’t be skipped" />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
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
  const { data: template, isLoading, error, refetch, isRefetching } = useTemplate(id!)
  const tasks = [...(template?.tasks ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo)
  const required = tasks.filter((t) => t.required).length
  const reorder = useReorderTemplateTasks(id!)
  const del = useDeleteTemplateTask(id!)
  const move = async (index: number, dir: -1 | 1) => {
    const ids = tasks.map((t) => t.id)
    const to = index + dir
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    try { await reorder.mutateAsync(ids); toast.success('Order saved') } catch (e) { toast.error('Couldn’t change the order', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const remove = async () => {
    if (!deleting) return
    try { await del.mutateAsync(deleting.id); toast.success('Task deleted'); setDeleting(null) }
    catch (e) { toast.error('Couldn’t delete the task', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const columns: TableColumn<OnboardingTask>[] = [
    { key: 'n', header: '#', width: 48, render: (_t, i) => <span className="onb-muted onb-num">{i + 1}</span> },
    {
      key: 'title', header: 'Task', primary: true, render: (t) => (
        <span className="onb-cell2"><span className="onb-strong">{t.title}</span>{t.description && <span className="onb-muted">{t.description}</span>}</span>
      ),
    },
    { key: 'due', header: 'Due', render: (t) => dueLabel(t.dueOffsetDays) },
    { key: 'owner', header: 'Owner role', render: (t) => (t.ownerRole ? roleLabel(t.ownerRole) : <span className="onb-muted">No owner role</span>) },
    { key: 'req', header: 'Required', render: (t) => (t.required ? <StatusPill tone="success">Required</StatusPill> : <StatusPill tone="muted">Optional</StatusPill>) },
    ...(canWrite ? [{
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (t: OnboardingTask, i: number) => (
        <CellActions>
          <Button variant="secondary" size={30} disabled={reorder.isPending || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.title} up`}>Move up</Button>
          <Button variant="secondary" size={30} disabled={reorder.isPending || i === tasks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.title} down`}>Move down</Button>
          <Button variant="danger-outline" size={30} disabled={del.isPending} onClick={() => setDeleting(t)} aria-label={`Delete task ${t.title}`}>Delete</Button>
        </CellActions>
      ),
    }] : []),
  ]
  return (
    <PageFrame label="Checklist template">
      <PageHeader eyebrow="Onboarding · Checklist template" title={template?.name || 'Checklist template'}
        sub={template ? (template.description || (template.active ? 'Active: offered when starting onboarding.' : 'Archived: not offered for new hires.')) : undefined}
        actions={<>
          <Button variant="secondary" size={40} icon="chevronLeft" onClick={() => navigate('/hrms/onboarding/instances?view=templates')}>All templates</Button>
          {template && canWrite && <Button variant="secondary" size={40} icon="pencil" onClick={() => setEditOpen(true)}>Edit</Button>}
        </>} />
      {!isLoading && !error && !template ? (
        <Section title="Template" empty={{ title: 'Template not found', hint: 'It may have been removed.', icon: 'list', variant: 'plain' }} />
      ) : (
        <>
          <Section title="Template" loading={isLoading} skeleton="text" error={error} onRetry={() => refetch()} retrying={isRefetching}>
            {template && (
              <KeyValueGrid items={[
                { key: 'status', label: 'Status', value: <StatusPill tone={template.active ? 'success' : 'muted'}>{template.active ? 'Active' : 'Archived'}</StatusPill> },
                { key: 'tasks', label: 'Tasks', value: String(tasks.length) },
                { key: 'required', label: 'Required', value: String(required) },
                { key: 'optional', label: 'Optional', value: String(tasks.length - required) },
              ]} />
            )}
          </Section>
          {template && (
            <Section title="Tasks, in order" body="flush"
              actions={canWrite ? <Button variant="primary" size={36} icon="plus" onClick={() => setAddOpen(true)}>Add task</Button> : undefined}
              empty={tasks.length === 0 ? { title: 'No tasks yet', hint: canWrite ? 'Add the first task to build the checklist.' : 'This template has no tasks yet.', icon: 'list', variant: 'plain' } : undefined}
              footer={canWrite && tasks.length > 1 ? <span className="onb-muted">New onboardings follow this order. Onboardings that already started keep the order they began with.</span> : undefined}>
              <Table label="Tasks, in order" columns={columns} rows={tasks} rowKey={(t) => t.id} mobile="cards" />
            </Section>
          )}
        </>
      )}
      {template && <AddTaskPanel templateId={template.id} nextSeq={(tasks.at(-1)?.sequenceNo ?? 0) + 1} open={addOpen} onClose={() => setAddOpen(false)} />}
      {template && <EditTemplatePanel template={template} open={editOpen} onClose={() => setEditOpen(false)} />}
      <Dialog open={!!deleting} onClose={() => { if (!del.isPending) setDeleting(null) }} busy={del.isPending} tone="danger" icon="trash"
        title={deleting ? `Delete “${deleting.title}”?` : 'Delete task?'} sub="It comes off this template. Onboardings already started keep their copy."
        footer={<>
          <PanelButton variant="secondary" disabled={del.isPending} onClick={() => setDeleting(null)}>Keep it</PanelButton>
          <PanelButton variant="danger" busy={del.isPending} onClick={remove}>Delete task</PanelButton>
        </>} />
    </PageFrame>
  )
}
