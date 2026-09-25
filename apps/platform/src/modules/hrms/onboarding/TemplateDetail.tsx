// One checklist template (/hrms/onboarding/templates/:id) on the module kit:
// its tasks in order, and for template writers edit / add / delete.
// There is no reorder endpoint (sequenceNo is set when a task is added), so
// the list shows order without pretending it can be dragged.
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Pencil, Plus } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrDrawer, HrStatusPill } from '@/shared/components/hr'
import { ModulePage, State, RowList, Row, SubHeading, Facts, useDesignToast } from '@/design/module/ModuleKit'
import { useTemplate, useCreateTemplateTask, useDeleteTemplateTask, useUpdateTemplate } from './api/useOnboarding'
import type { OnboardingTask, OnboardingTemplate } from './api/useOnboarding'

type Toast = (msg: string, err?: boolean, detail?: string) => void
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
/** HR_MANAGER → "HR manager" */
export const roleLabel = (code: string) => code.split('_').map((w, i) => (['HR', 'IT'].includes(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')
const dayLabel = (n: number) => (n <= 0 ? 'On the joining day' : `Day ${n} after joining`)

function EditTemplateDrawer({ template, onClose, toast }: { template: OnboardingTemplate; onClose: () => void; toast: Toast }) {
  const update = useUpdateTemplate(template.id)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [active, setActive] = useState(template.active)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({ companyId: template.companyId, name: name.trim(), description: description.trim() || undefined, designationId: template.designationId, departmentId: template.departmentId, active })
      toast('Template saved'); onClose()
    } catch (err) { toast('Couldn’t save the template', true, (err as Error)?.message) }
  }
  return (
    <HrDrawer title="Edit template" onClose={onClose}
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="tpl-edit" disabled={update.isPending || !name.trim()}>{update.isPending ? 'Saving…' : 'Save changes'}</HrButton></>}>
      <form id="tpl-edit" onSubmit={submit} className="space-y-4">
        <div><label className={label} htmlFor="tpl-edit-name">Template name</label><input id="tpl-edit-name" required value={name} onChange={(e) => setName(e.target.value)} className="ut-input" /></div>
        <div><label className={label} htmlFor="tpl-edit-desc">Description</label><textarea id="tpl-edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" rows={3} className="ut-input resize-none" /></div>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#059669]" /> Active: offered when starting onboarding</label>
      </form>
    </HrDrawer>
  )
}

function AddTaskDrawer({ templateId, nextSeq, onClose, toast }: { templateId: string; nextSeq: number; onClose: () => void; toast: Toast }) {
  const create = useCreateTemplateTask(templateId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOffsetDays, setDueOffsetDays] = useState(1)
  const [ownerRole, setOwnerRole] = useState('')
  const [required, setRequired] = useState(true)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined, dueOffsetDays, ownerRole: ownerRole.trim() || null, required, sequenceNo: nextSeq })
      toast('Task added'); onClose()
    } catch (err) { toast('Couldn’t add the task', true, (err as Error)?.message) }
  }
  return (
    <HrDrawer title="Add a task" onClose={onClose}
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="tpl-task" disabled={create.isPending || !title.trim()}>{create.isPending ? 'Adding…' : 'Add task'}</HrButton></>}>
      <form id="tpl-task" onSubmit={submit} className="space-y-4">
        <div><label className={label} htmlFor="task-title">Task</label><input id="task-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete IT setup" className="ut-input" /></div>
        <div><label className={label} htmlFor="task-desc">Description</label><textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" className="ut-input resize-none" /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="task-due">Due (days after joining)</label><input id="task-due" type="number" min={1} value={dueOffsetDays} onChange={(e) => setDueOffsetDays(Number(e.target.value))} className="ut-input" /></div>
          <div><label className={label} htmlFor="task-owner">Owner role</label><input id="task-owner" value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder="e.g. HR_MANAGER" className="ut-input" /></div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[#059669]" /> Required: it can’t be skipped</label>
      </form>
    </HrDrawer>
  )
}

function TaskRow({ task, templateId, canWrite, toast, n }: { task: OnboardingTask; templateId: string; canWrite: boolean; toast: Toast; n: number }) {
  const del = useDeleteTemplateTask(templateId)
  const remove = async () => {
    if (!window.confirm(`Delete “${task.title}” from this template? Onboarding already started keeps its copy.`)) return
    try { await del.mutateAsync(task.id); toast('Task deleted') } catch (e) { toast('Couldn’t delete the task', true, (e as Error)?.message) }
  }
  return (
    <Row
      lead={<span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>}
      title={task.title}
      meta={[dayLabel(task.dueOffsetDays), task.description].filter(Boolean).join(' · ')}
      trail={<>
        {task.required ? <HrStatusPill tone="warn">Required</HrStatusPill> : <HrStatusPill tone="gray">Optional</HrStatusPill>}
        {task.ownerRole && <HrStatusPill tone="info">{roleLabel(task.ownerRole)}</HrStatusPill>}
        {canWrite && <HrButton size="sm" variant="ghost" disabled={del.isPending} onClick={remove} aria-label={`Delete task ${task.title}`}>Delete</HrButton>}
      </>} />
  )
}

export const TemplateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const canWrite = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const { show, node } = useDesignToast()
  const { data: template, isLoading, error, refetch } = useTemplate(id!)
  const tasks = [...(template?.tasks ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo)
  const required = tasks.filter((t) => t.required).length
  const back = <HrButton variant="ghost" onClick={() => navigate('/hrms/onboarding/instances?view=templates')}>← All templates</HrButton>
  return (
    <ModulePage crumb="Onboarding · Checklist template" title={template?.name || 'Checklist template'} subtitle={template?.description || undefined}
      actions={<>{back}{template && canWrite && <HrButton variant="ghost" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</HrButton>}</>}>
      {isLoading ? <State kind="loading" height={220} />
        : error ? <State kind="error" title="Couldn’t load the template" description={(error as Error).message} onRetry={() => refetch()} />
          : template ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <Facts items={[
                { k: 'Status', v: <HrStatusPill tone={template.active ? 'ok' : 'gray'}>{template.active ? 'Active' : 'Archived'}</HrStatusPill> },
                { k: 'Tasks', v: String(tasks.length) },
                { k: 'Required', v: String(required) },
                { k: 'Optional', v: String(tasks.length - required) },
              ]} />
              <SubHeading aside={canWrite ? <HrButton size="sm" onClick={() => setAddOpen(true)}><Plus size={14} /> Add task</HrButton> : undefined}>Tasks, in order</SubHeading>
              {tasks.length === 0
                ? <State kind="empty" icon="list" title="No tasks yet" description={canWrite ? 'Add the first task to build the checklist.' : 'This template has no tasks yet.'} />
                : <RowList>{tasks.map((t, i) => <TaskRow key={t.id} task={t} n={i + 1} templateId={template.id} canWrite={canWrite} toast={show} />)}</RowList>}
            </div>
          ) : <State kind="empty" icon="list" title="Template not found" />}
      {addOpen && template && <AddTaskDrawer templateId={template.id} nextSeq={(tasks.at(-1)?.sequenceNo ?? 0) + 1} onClose={() => setAddOpen(false)} toast={show} />}
      {editOpen && template && <EditTemplateDrawer template={template} onClose={() => setEditOpen(false)} toast={show} />}
      {node}
    </ModulePage>
  )
}
