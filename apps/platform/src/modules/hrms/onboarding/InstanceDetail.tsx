import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, SkipForward, Clock } from 'lucide-react'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { useEmployeeInstance, useInstanceTasks, useCompleteTask, useSkipTask } from './api/useOnboarding'
import type { OnboardingInstanceTask } from './api/useOnboarding'
import { HrPageHeader, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
import { clsx } from 'clsx'

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  instanceId,
}: {
  task: OnboardingInstanceTask
  instanceId: string
}) {
  const complete = useCompleteTask(instanceId)
  const skip = useSkipTask(instanceId)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState('')

  const isDone = task.status === 'COMPLETED' || task.status === 'SKIPPED'

  const statusTone = (): PillTone => {
    if (task.status === 'COMPLETED') return 'ok'
    if (task.status === 'SKIPPED') return 'gray'
    return 'warn'
  }

  const handleComplete = () => {
    complete.mutate(
      { taskId: task.id, notes: notes || undefined },
      {
        onSuccess: () => { toast.success('Task completed'); setNotesOpen(false); setNotes('') },
        onError: () => toast.error('Failed to complete task'),
      },
    )
  }

  const handleSkip = () => {
    skip.mutate(
      { taskId: task.id },
      {
        onSuccess: () => toast.success('Task skipped'),
        onError: () => toast.error('Failed to skip task'),
      },
    )
  }

  return (
    <div
      className={clsx(
        'rounded-xl border bg-bg-surface p-4 space-y-2 transition-opacity',
        isDone ? 'border-border-default opacity-60' : 'border-border-default',
      )}
    >
      <div className="flex items-start gap-2 justify-between">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {task.status === 'COMPLETED' ? (
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-status-success-fg" />
          ) : task.status === 'SKIPPED' ? (
            <SkipForward size={16} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
          ) : (
            <Clock size={16} className="mt-0.5 flex-shrink-0 text-status-warning-fg" />
          )}
          <div className="min-w-0">
            <p className={clsx('text-sm font-medium', isDone ? 'text-text-tertiary line-through' : 'text-text-primary')}>
              {task.title ?? 'Untitled task'}
            </p>
            {task.dueDate && (
              <p className="text-xs text-text-tertiary">Due {task.dueDate}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {task.required && !isDone && <HrStatusPill tone="warn">Required</HrStatusPill>}
          <HrStatusPill tone={statusTone()}>{task.status}</HrStatusPill>
        </div>
      </div>

      {!isDone && (
        <Can code={P.HRMS_ONBOARDING_TASK_COMPLETE}>
          <div className="space-y-2">
            {notesOpen && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional completion notes"
                rows={2}
                className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default/40 resize-none"
              />
            )}
            <div className="flex gap-2">
              <HrButton
                size="sm"
                disabled={complete.isPending}
                onClick={() => (notesOpen ? handleComplete() : setNotesOpen(true))}
              >
                <CheckCircle2 size={12} />
                {notesOpen ? 'Confirm complete' : 'Complete'}
              </HrButton>
              {!task.required && (
                <HrButton
                  size="sm"
                  variant="ghost"
                  disabled={skip.isPending}
                  onClick={handleSkip}
                >
                  Skip
                </HrButton>
              )}
              {notesOpen && (
                <HrButton
                  size="sm"
                  variant="ghost"
                  onClick={() => { setNotesOpen(false); setNotes('') }}
                >
                  Cancel
                </HrButton>
              )}
            </div>
          </div>
        </Can>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export const InstanceDetail: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>()
  const navigate = useNavigate()

  const { data: instance, isLoading: instLoading, error: instError, refetch: refetchInst } = useEmployeeInstance(employeeId!)
  const { data: tasks = [], isLoading: tasksLoading, error: tasksError, refetch: refetchTasks } = useInstanceTasks(instance?.id ?? '')

  const isLoading = instLoading || (!!instance && tasksLoading)
  const error = instError || tasksError

  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length
  const totalCount = tasks.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const sortedTasks = [...tasks].sort((a, b) => a.sequenceNo - b.sequenceNo)

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8 animate-fade-in space-y-6">
      <button
        onClick={() => navigate('/hrms/onboarding/instances')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={16} />
        Instances
      </button>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load instance"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => { refetchInst(); refetchTasks() } }}
        />
      ) : instance ? (
        <>
          <HrPageHeader
            crumb="Recruitment & Onboarding"
            title="Onboarding Checklist"
            subtitle={
              <>
                Started {new Date(instance.startedAt).toLocaleDateString()}
                {instance.completedAt &&
                  ` · Completed ${new Date(instance.completedAt).toLocaleDateString()}`}
              </>
            }
            actions={
              <HrStatusPill tone={instance.status === 'COMPLETED' ? 'ok' : 'info'}>
                {instance.status}
              </HrStatusPill>
            }
          />

          {totalCount > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-text-tertiary">
                <span>{completedCount} of {totalCount} tasks complete</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-base">
                <div
                  className="h-full rounded-full bg-[#FF9D00] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            {sortedTasks.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-8">
                No tasks in this instance.
              </p>
            ) : (
              sortedTasks.map((task) => (
                <TaskCard key={task.id} task={task} instanceId={instance.id} />
              ))
            )}
          </div>
        </>
      ) : (
        <EmptyState
          variant="first-run"
          title="No onboarding instance"
          description="This employee does not have an active onboarding instance."
        />
      )}
    </div>
  )
}
