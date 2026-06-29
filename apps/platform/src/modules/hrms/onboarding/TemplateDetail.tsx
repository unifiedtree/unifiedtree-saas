import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, GripVertical, Pencil } from 'lucide-react'
import { Drawer, Button, CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrStatusPill, HrButton } from '@/shared/components/hr'
import {
  useTemplate, useCreateTemplateTask, useDeleteTemplateTask, useUpdateTemplate,
} from './api/useOnboarding'
import type { OnboardingTask, OnboardingTemplate } from './api/useOnboarding'

// ── Edit template drawer ───────────────────────────────────────────────────────

function EditTemplateDrawer({
  template,
  onClose,
}: {
  template: OnboardingTemplate
  onClose: () => void
}) {
  const update = useUpdateTemplate(template.id)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [active, setActive] = useState(template.active)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    update.mutate(
      {
        companyId: template.companyId,
        name: name.trim(),
        description: description.trim() || undefined,
        designationId: template.designationId,
        departmentId: template.departmentId,
        active,
      },
      {
        onSuccess: () => {
          toast.success('Template updated')
          onClose()
        },
        onError: () => toast.error('Failed to update template'),
      },
    )
  }

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }} title="Edit template">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Template name *
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40 resize-none"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="accent-[#FF9D00]"
          />
          <span className="text-sm text-text-primary">Active</span>
        </label>
        <div className="flex gap-2 border-t border-border-default pt-4">
          <Button type="submit" size="sm" loading={update.isPending}>Save changes</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Drawer>
  )
}

// ── Add task drawer ────────────────────────────────────────────────────────────

function AddTaskDrawer({
  templateId,
  nextSeq,
  onClose,
}: {
  templateId: string
  nextSeq: number
  onClose: () => void
}) {
  const create = useCreateTemplateTask(templateId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOffsetDays, setDueOffsetDays] = useState(1)
  const [ownerRole, setOwnerRole] = useState('')
  const [required, setRequired] = useState(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        dueOffsetDays,
        ownerRole: ownerRole.trim() || null,
        required,
        sequenceNo: nextSeq,
      },
      {
        onSuccess: () => {
          toast.success('Task added')
          onClose()
        },
        onError: () => toast.error('Failed to add task'),
      },
    )
  }

  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }} title="Add task">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Task title *
          </label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Complete IT setup"
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40 resize-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Due (days after join)
            </label>
            <input
              type="number"
              min={1}
              value={dueOffsetDays}
              onChange={(e) => setDueOffsetDays(Number(e.target.value))}
              className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Owner role
            </label>
            <input
              value={ownerRole}
              onChange={(e) => setOwnerRole(e.target.value)}
              placeholder="e.g. HR_MANAGER"
              className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="accent-[#FF9D00]"
          />
          <span className="text-sm text-text-primary">Required task</span>
        </label>
        <div className="flex gap-2 border-t border-border-default pt-4">
          <Button type="submit" size="sm" loading={create.isPending}>Add task</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Drawer>
  )
}

// ── Task row ───────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  templateId,
  canWrite,
}: {
  task: OnboardingTask
  templateId: string
  canWrite: boolean
}) {
  const del = useDeleteTemplateTask(templateId)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border-default bg-bg-surface px-4 py-3">
      <GripVertical size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-text-primary">{task.title}</p>
          {task.required && <HrStatusPill tone="warn">Required</HrStatusPill>}
          {task.ownerRole && (
            <HrStatusPill tone="info">{task.ownerRole}</HrStatusPill>
          )}
        </div>
        {task.description && (
          <p className="mt-0.5 text-xs text-text-tertiary">{task.description}</p>
        )}
        <p className="mt-1 text-xs text-text-tertiary">
          Due day&nbsp;{task.dueOffsetDays} after joining
        </p>
      </div>
      {canWrite && (
        <button
          onClick={() => del.mutate(task.id, {
            onError: () => toast.error('Failed to delete task'),
          })}
          disabled={del.isPending}
          className="flex-shrink-0 rounded-lg p-1.5 text-text-tertiary hover:bg-status-danger-bg hover:text-status-danger-fg transition-colors disabled:opacity-40"
          aria-label="Delete task"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export const TemplateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const { data: template, isLoading, error, refetch } = useTemplate(id!)

  const sortedTasks = [...(template?.tasks ?? [])].sort(
    (a, b) => a.sequenceNo - b.sequenceNo,
  )

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8 animate-fade-in space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/hrms/onboarding')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          Templates
        </button>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load template"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : template ? (
        <>
          <HrPageHeader
            crumb="Recruitment & Onboarding"
            title={template.name}
            subtitle={template.description || undefined}
            actions={
              <>
                <HrStatusPill tone={template.active ? 'ok' : 'gray'}>
                  {template.active ? 'Active' : 'Inactive'}
                </HrStatusPill>
                <Can code={P.HRMS_ONBOARDING_TEMPLATE_WRITE}>
                  <HrButton variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil size={12} />
                    Edit template
                  </HrButton>
                </Can>
              </>
            }
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Tasks ({sortedTasks.length})
              </h2>
              <Can code={P.HRMS_ONBOARDING_TEMPLATE_WRITE}>
                <HrButton size="sm" onClick={() => setAddOpen(true)}>
                  <Plus size={12} />
                  Add task
                </HrButton>
              </Can>
            </div>

            {sortedTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-sm text-text-tertiary">
                No tasks yet. Add the first task to build the checklist.
              </div>
            ) : (
              <div className="space-y-2">
                {sortedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    templateId={template.id}
                    canWrite={true}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {addOpen && template && (
        <AddTaskDrawer
          templateId={template.id}
          nextSeq={(sortedTasks.at(-1)?.sequenceNo ?? 0) + 1}
          onClose={() => setAddOpen(false)}
        />
      )}

      {editOpen && template && (
        <EditTemplateDrawer template={template} onClose={() => setEditOpen(false)} />
      )}
    </div>
  )
}
