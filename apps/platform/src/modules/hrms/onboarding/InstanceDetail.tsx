// One onboarding checklist (/hrms/onboarding/instances/:id) on the redesign kit (P-HIRE;
// prototype PgTalent h-onb, "Open record"). HR sees whose it is and can hold / resume /
// reopen it and edit the hire details; the new hire (the API only lets them open their own)
// sees "Your onboarding", including their hiring manager and buddy. Ticking a task off needs
// hrms.onboarding.task.complete; required tasks can't be skipped.
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, Callout, CellPerson, KeyValueGrid, PageFrame, PageHeader, ProgressBar, Section, StatusPill } from '@/design/kit/display'
import { Textarea, useToast } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { useInstance, useInstanceTasks, useCompleteTask, useSkipTask, useUpdateInstanceStatus } from './api/useOnboarding'
import type { OnboardingInstanceTask, OnboardingInstanceStatus } from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import { instanceState, roleLabel } from './onboardingModel'
import { dayMon, istTodayIso } from '../hiring/hiringModel'
import { HireDetailsPanel } from './HireDetails'
import '../hiring/hiring.css'

const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const stampOf = (at: string) => new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function TaskItem({ task, instanceId, canAct, today }: { task: OnboardingInstanceTask; instanceId: string; canAct: boolean; today: string }) {
  const toast = useToast()
  const complete = useCompleteTask(instanceId)
  const skip = useSkipTask(instanceId)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const done = task.status === 'COMPLETED', skipped = task.status === 'SKIPPED', closed = done || skipped
  const overdue = !closed && !!task.dueDate && task.dueDate.slice(0, 10) < today
  const run = async (kind: 'complete' | 'skip') => {
    try {
      if (kind === 'complete') await complete.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      else await skip.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      toast.success(kind === 'complete' ? 'Task done' : 'Task skipped'); setNoteOpen(false); setNote('')
    } catch (e) { toast.error(kind === 'complete' ? 'Couldn’t complete the task' : 'Couldn’t skip the task', { detail: errText(e) }) }
  }
  const [pill, tone, dot] = done ? ['Done', 'success', 'done'] as const : skipped ? ['Skipped', 'neutral', 'skipped'] as const : overdue ? ['Overdue', 'danger', 'overdue'] as const : ['To do', 'warning', 'todo'] as const
  const when = [task.dueDate ? `Due ${dayMon(task.dueDate, today)}` : null, closed && task.completedAt ? `${done ? 'Done' : 'Skipped'} ${stampOf(task.completedAt)}` : null].filter(Boolean).join(' · ')
  return (
    <article className={`hi-task${closed ? ' is-closed' : ''}`}>
      <span className="hi-task__dot" data-tone={dot} aria-hidden="true">{dashIcon(done ? 'checkCircle' : skipped ? 'arrowRight' : 'clock', 15)}</span>
      <div className="hi-task__body">
        <div className="hi-task__head">
          <span className="hi-task__title">{task.title || 'Untitled task'}</span>
          <StatusPill tone={tone}>{pill}</StatusPill>
          {task.required && !closed && <StatusPill tone="amber">Required</StatusPill>}
          {task.ownerRole && <StatusPill tone="info">{roleLabel(task.ownerRole)}</StatusPill>}
        </div>
        <span className="hi-task__meta">{when || 'No due date'}</span>
        {task.notes && <span className="hi-task__note">{task.notes}</span>}
        {canAct && !closed && (
          <>
            {noteOpen && <Textarea aria-label={`Note for ${task.title || 'task'}`} rows={2} value={note} maxLength={2000} size="md"
              placeholder="Optional note, saved with the task (or the reason for skipping)" onChange={(e) => setNote(e.target.value)} />}
            <div className="hi-task__acts">
              <Button size={32} variant="soft" loading={complete.isPending} onClick={() => run('complete')}>Mark done</Button>
              {!noteOpen ? <Button size={32} variant="secondary" onClick={() => setNoteOpen(true)}>Add note</Button>
                : <Button size={32} variant="secondary" onClick={() => { setNoteOpen(false); setNote('') }}>Remove note</Button>}
              {!task.required && <Button size={32} variant="secondary" loading={skip.isPending} onClick={() => run('skip')}>Skip</Button>}
            </div>
          </>
        )}
      </div>
    </article>
  )
}

export const InstanceDetail: React.FC = () => {
  const { instanceId } = useParams<{ instanceId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canAct = usePermission(P.HRMS_ONBOARDING_TASK_COMPLETE)
  const canReadEmployees = usePermission('hrms.employee.read')
  const today = istTodayIso()
  const { data: instance, isLoading: instLoading, error: instError, refetch: refetchInst } = useInstance(instanceId!)
  const { data: tasks = [], isLoading: tasksLoading, error: tasksError, refetch: refetchTasks } = useInstanceTasks(instance?.id ?? '')
  const { data: people } = useEmployeesByIds(instance?.employeeId ? [instance.employeeId] : [], { enabled: canReadEmployees && !!instance })
  const emp = people?.[0]
  const updateStatus = useUpdateInstanceStatus()
  const isLoading = instLoading || (!!instance && tasksLoading)
  const error = instError || tasksError
  const sorted = [...tasks].sort((a, b) => a.sequenceNo - b.sequenceNo)
  const done = tasks.filter((t) => t.status === 'COMPLETED').length
  const skipped = tasks.filter((t) => t.status === 'SKIPPED').length
  const open = tasks.length - done - skipped
  const requiredOpen = tasks.filter((t) => t.required && t.status !== 'COMPLETED' && t.status !== 'SKIPPED').length
  const pct = tasks.length ? Math.round(((done + skipped) / tasks.length) * 100) : 0
  const name = emp ? [emp.firstName, emp.lastName].filter(Boolean).join(' ') : ''
  const title = !isHr ? 'Your onboarding' : name ? `${name}’s onboarding` : 'Onboarding checklist'
  const state = instance ? instanceState(instance.status, emp?.dateOfJoining ?? null, today) : null
  const setStatus = async (next: OnboardingInstanceStatus, msg: string) => {
    try { await updateStatus.mutateAsync({ instanceId: instance!.id, status: next }); toast.success(msg); refetchInst() } catch (e) { toast.error('Couldn’t update the onboarding', { detail: errText(e) }) }
  }
  const hrAction = instance && isHr ? (
    instance.status === 'IN_PROGRESS' ? <Button variant="secondary" size={40} loading={updateStatus.isPending} onClick={() => setStatus('ON_HOLD', 'Onboarding put on hold')}>Put on hold</Button>
      : instance.status === 'ON_HOLD' ? <Button variant="primary" size={40} loading={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding resumed')}>Resume</Button>
        : instance.status === 'COMPLETED' ? <Button variant="secondary" size={40} loading={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding reopened')}>Reopen</Button> : null
  ) : null
  return (
    <PageFrame label={title} width={isHr ? 'wide' : 'narrow'} className="hi-page">
      <PageHeader eyebrow={isHr ? 'Onboarding · Record' : 'Onboarding'} title={title}
        sub={instance ? `Started ${dayMon(instance.startedAt, today)}${instance.completedAt ? ` · completed ${dayMon(instance.completedAt, today)}` : ''}` : undefined}
        actions={<>
          <Button variant="secondary" size={40} icon="chevronLeft" onClick={() => navigate('/hrms/onboarding/instances')}>{isHr ? 'All onboarding' : 'Back'}</Button>
          {hrAction}
        </>} />
      {error ? <Section title="Onboarding" error={error} onRetry={() => { refetchInst(); refetchTasks() }}>{null}</Section>
        : !isLoading && !instance ? <Section title="Onboarding" empty={{ title: 'No onboarding found', hint: 'It may have been removed, or it belongs to someone else.', icon: 'clipboard' }}>{null}</Section>
          : (
            <>
              {isHr && emp && (
                <Section title="New hire" level={3} body="tight"
                  actions={canReadEmployees ? <Button size={32} variant="secondary" onClick={() => navigate(`/hrms/employees/${emp.id}`)}>Open profile</Button> : undefined}>
                  <CellPerson name={name || 'Employee'} sub={[emp.employeeCode, emp.email].filter(Boolean).join(' · ')} size={36} />
                </Section>
              )}
              {instance && <HireDetailsPanel instanceId={instance.id} isHr={isHr} />}
              <Section title="Progress" level={3} body="tight" loading={isLoading} skeleton="text">
                {instance && state && (
                  <div className="hi-stack">
                    <KeyValueGrid items={[
                      { key: 'status', label: 'Status', value: <StatusPill tone={state.tone}>{state.label}</StatusPill> },
                      { key: 'pct', label: 'Progress', value: `${pct}%` },
                      { key: 'done', label: 'Done', value: String(done) },
                      { key: 'open', label: 'Still to do', value: String(open) },
                      ...(skipped ? [{ key: 'skipped', label: 'Skipped', value: String(skipped) }] : []),
                    ]} />
                    {tasks.length > 0 && <ProgressBar value={done + skipped} max={tasks.length} height={8} label={`${pct}% of the checklist done`} />}
                    {instance.status === 'ON_HOLD' && <Callout tone="warning">HR has put this onboarding on hold.</Callout>}
                    {instance.status === 'IN_PROGRESS' && requiredOpen > 0 && <Callout tone="neutral">{`${requiredOpen} required ${requiredOpen === 1 ? 'task is' : 'tasks are'} still open. The onboarding completes itself when every task is done or skipped.`}</Callout>}
                  </div>
                )}
              </Section>
              <Section title="Checklist" level={3} body="flush" loading={isLoading} skeleton="list"
                empty={instance && sorted.length === 0 ? { title: 'No tasks on this checklist', hint: 'The template had no tasks when this onboarding started.', icon: 'list' } : undefined}>
                <div className="hi-tasks">
                  {instance && sorted.map((t) => <TaskItem key={t.id} task={t} instanceId={instance.id} canAct={canAct} today={today} />)}
                </div>
              </Section>
            </>
          )}
    </PageFrame>
  )
}
