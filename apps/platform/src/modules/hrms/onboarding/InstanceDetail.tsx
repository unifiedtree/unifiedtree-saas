// One onboarding (/hrms/onboarding/instances/:id) on the redesign kit (prototype PgTalent
// "Onboarding record"). HR sees whose it is, can hold / resume / reopen it, edit the hire details,
// and (with hrms.employee.write) read the record the new-hire form saved; the new hire (the API
// only lets them open their own) sees "Your onboarding", including their hiring manager and buddy.
// Ticking a task off needs hrms.onboarding.task.complete; required tasks can't be skipped.
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import {
  Button, Callout, CellPerson, KeyValueGrid, PageFrame, PageHeader, ProgressBar, Section, StatusPill, errorText,
} from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import { Textarea, useToast } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { istToday } from '@/design/dc/dates'
import { useInstance, useInstanceTasks, useCompleteTask, useSkipTask, useUpdateInstanceStatus } from './api/useOnboarding'
import type { OnboardingInstanceTask, OnboardingInstanceStatus } from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import { HireDetailsPanel } from './HireDetails'
import { OnboardingRecord } from './OnboardingRecord'
import { fullDate, roleLabel, runStatusLabel, runStatusTone, taskPill } from './onboardingModel'
import './onboarding.css'

function TaskItem({ task, instanceId, canAct, today, onChanged }: { task: OnboardingInstanceTask; instanceId: string; canAct: boolean; today: string; onChanged: () => void }) {
  const complete = useCompleteTask(instanceId)
  const skip = useSkipTask(instanceId)
  const toast = useToast()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const pill = taskPill(task, today)
  const done = task.status === 'COMPLETED', skipped = task.status === 'SKIPPED'
  const run = async (kind: 'complete' | 'skip') => {
    try {
      if (kind === 'complete') await complete.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      else await skip.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      toast.success(kind === 'complete' ? 'Task done' : 'Task skipped'); setNoteOpen(false); setNote('')
      // The run's own status (it completes itself after the last task) lives under another key.
      onChanged()
    } catch (e) { toast.error(kind === 'complete' ? 'Couldn’t complete the task' : 'Couldn’t skip the task', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const dot = done ? 'done' : skipped ? 'skipped' : pill.label === 'Overdue' ? 'overdue' : 'todo'
  const when = [task.dueDate ? `Due ${fullDate(task.dueDate)}` : null, pill.closed && task.completedAt ? `${done ? 'Done' : 'Skipped'} ${new Date(task.completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : null]
    .filter(Boolean).join(' · ') || 'No due date'
  return (
    <article className={`onb-task${pill.closed ? ' is-closed' : ''}`}>
      <span aria-hidden="true" className={`onb-task__dot onb-task__dot--${dot}`}>{dashIcon(done ? 'checkCircle' : skipped ? 'arrowRight' : 'clock', 15)}</span>
      <div className="onb-task__body">
        <div className="onb-row">
          <span className="onb-task__title">{task.title || 'Untitled task'}</span>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          {task.required && !pill.closed && <StatusPill tone="amber">Required</StatusPill>}
          {task.ownerRole && <StatusPill tone="info">{roleLabel(task.ownerRole)}</StatusPill>}
        </div>
        <span className="onb-muted">{when}</span>
        {task.notes && <span className="onb-task__note">{task.notes}</span>}
        {canAct && !pill.closed && (
          <div style={{ display: 'grid', gap: 8 }}>
            {noteOpen && (
              <Textarea aria-label={`Note for ${task.title || 'task'}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note, saved with the task (or the reason for skipping)" />
            )}
            <div className="onb-row">
              <Button variant="primary" size={32} loading={complete.isPending} onClick={() => run('complete')}>Mark done</Button>
              {!noteOpen ? <Button variant="secondary" size={32} onClick={() => setNoteOpen(true)}>Add note</Button>
                : <Button variant="secondary" size={32} onClick={() => { setNoteOpen(false); setNote('') }}>Remove note</Button>}
              {!task.required && <Button variant="secondary" size={32} loading={skip.isPending} onClick={() => run('skip')}>Skip</Button>}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

export const InstanceDetail: React.FC = () => {
  const { instanceId } = useParams<{ instanceId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canAct = usePermission(P.HRMS_ONBOARDING_TASK_COMPLETE)
  const canReadEmployees = usePermission('hrms.employee.read')
  const canReadRecord = usePermission('hrms.employee.write')
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
  const setStatus = async (next: OnboardingInstanceStatus, msg: string) => {
    try { await updateStatus.mutateAsync({ instanceId: instance!.id, status: next }); toast.success(msg); refetchInst() }
    catch (e) { toast.error('Couldn’t update the onboarding', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const back = <Button variant="secondary" size={40} icon="chevronLeft" onClick={() => navigate('/hrms/onboarding/instances')}>{isHr ? 'All onboarding' : 'Back'}</Button>
  const hrAction = instance && isHr ? (
    instance.status === 'IN_PROGRESS' ? <Button variant="secondary" size={40} icon="clock" loading={updateStatus.isPending} onClick={() => setStatus('ON_HOLD', 'Onboarding put on hold')}>Put on hold</Button>
      : instance.status === 'ON_HOLD' ? <Button variant="primary" size={40} icon="arrowRight" loading={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding resumed')}>Resume</Button>
        : instance.status === 'COMPLETED' ? <Button variant="secondary" size={40} loading={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding reopened')}>Reopen</Button> : null
  ) : null
  return (
    <PageFrame label="Onboarding checklist">
      <PageHeader eyebrow="Onboarding" title={title}
        sub={instance ? `Started ${fullDate(instance.startedAt)}${instance.completedAt ? ` · completed ${fullDate(instance.completedAt)}` : ''}` : undefined}
        actions={<>{back}{hrAction}</>} />
      {isLoading || error || !instance ? (
        <Section title="Checklist" loading={isLoading} skeleton="list" error={error} onRetry={() => { refetchInst(); refetchTasks() }}
          empty={!instance ? { title: 'No onboarding found', hint: 'It may have been removed, or it belongs to someone else.', icon: 'clipboard', variant: 'plain' } : undefined} />
      ) : (
        <>
          <SectionGrid>
            {isHr && emp && (
              <SectionCell width="half">
                <Section title="New hire" actions={canReadEmployees ? <Button variant="secondary" size={32} onClick={() => navigate(`/hrms/employees/${emp.id}`)}>Open profile</Button> : undefined}>
                  <CellPerson size={36} name={name || 'Employee'} sub={[emp.employeeCode, emp.email].filter(Boolean).join(' · ')} />
                </Section>
              </SectionCell>
            )}
            <SectionCell width={isHr && emp ? 'half' : 'full'}>
              <Section title="Progress" sub={tasks.length ? `${done + skipped} of ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} done or skipped` : undefined}>
                <div className="onb-form">
                  <KeyValueGrid items={[
                    { key: 'status', label: 'Status', value: <StatusPill tone={runStatusTone(instance.status)}>{runStatusLabel(instance.status)}</StatusPill> },
                    { key: 'progress', label: 'Progress', value: `${pct}%` },
                    { key: 'done', label: 'Done', value: String(done) },
                    { key: 'open', label: 'Still to do', value: String(open) },
                    ...(skipped ? [{ key: 'skipped', label: 'Skipped', value: String(skipped) }] : []),
                  ]} />
                  {tasks.length > 0 && <ProgressBar value={pct} height={8} label="Checklist progress" valueText={`${pct}% done`} />}
                </div>
              </Section>
            </SectionCell>
            <SectionCell>
              <HireDetailsPanel instanceId={instance.id} isHr={isHr} />
            </SectionCell>
          </SectionGrid>
          {instance.status === 'ON_HOLD' && <Callout tone="warning" icon="clock">HR has put this onboarding on hold.</Callout>}
          {instance.status === 'IN_PROGRESS' && requiredOpen > 0 && (
            <Callout tone="info">{`${requiredOpen} required ${requiredOpen === 1 ? 'task is' : 'tasks are'} still open. The onboarding completes itself when every task is done or skipped.`}</Callout>
          )}
          <Section title="Checklist" body="flush" count={tasks.length || undefined} countTone="neutral"
            empty={sorted.length === 0 ? { title: 'No tasks on this checklist', hint: 'The template had no tasks when this onboarding started.', icon: 'list', variant: 'plain' } : undefined}>
            <div className="onb-tasks">
              {sorted.map((t) => <TaskItem key={t.id} task={t} instanceId={instance.id} canAct={canAct} today={today} onChanged={() => { void refetchInst() }} />)}
            </div>
          </Section>
          {isHr && canReadRecord && instance.employeeId && <OnboardingRecord employeeId={instance.employeeId} />}
        </>
      )}
    </PageFrame>
  )
}
