// One onboarding checklist (/hrms/onboarding/instances/:id) on the module kit.
// HR sees whose it is and can hold / resume / reopen it; the new hire (the API
// only lets them open their own) sees "Your onboarding". Ticking a task off
// needs hrms.onboarding.task.complete; required tasks can't be skipped.
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrStatusPill, HrButton, HrAvatar } from '@/shared/components/hr'
import { ModulePage, State, SubHeading, Facts, Panel, Note, useDesignToast, dmy, stamp, todayIso } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useInstance, useInstanceTasks, useCompleteTask, useSkipTask, useUpdateInstanceStatus } from './api/useOnboarding'
import type { OnboardingInstanceTask, OnboardingInstanceStatus } from './api/useOnboarding'
import { useEmployeesByIds } from '../api/useWorkforce'
import { statusLabel, statusTone } from './Instances'
import { roleLabel } from './TemplateDetail'

type Toast = (msg: string, err?: boolean, detail?: string) => void

function TaskItem({ task, instanceId, canAct, toast }: { task: OnboardingInstanceTask; instanceId: string; canAct: boolean; toast: Toast }) {
  const complete = useCompleteTask(instanceId)
  const skip = useSkipTask(instanceId)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const done = task.status === 'COMPLETED', skipped = task.status === 'SKIPPED', closed = done || skipped
  const overdue = !closed && !!task.dueDate && task.dueDate.slice(0, 10) < todayIso()
  const run = async (kind: 'complete' | 'skip') => {
    try {
      if (kind === 'complete') await complete.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      else await skip.mutateAsync({ taskId: task.id, notes: note.trim() || undefined })
      toast(kind === 'complete' ? 'Task done' : 'Task skipped'); setNoteOpen(false); setNote('')
    } catch (e) { toast(kind === 'complete' ? 'Couldn’t complete the task' : 'Couldn’t skip the task', true, (e as Error)?.message) }
  }
  const [pill, tone] = done ? ['Done', 'ok'] : skipped ? ['Skipped', 'gray'] : overdue ? ['Overdue', 'red'] : ['To do', 'warn']
  return (
    <article style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid #f1f5f9', opacity: closed ? 0.75 : 1 }}>
      <span aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 1, width: 26, height: 26, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: done ? '#ecfdf5' : skipped ? '#f1f5f9' : overdue ? '#fef2f2' : '#fffbeb', color: done ? '#059669' : skipped ? '#64748b' : overdue ? '#b91c1c' : '#b45309' }}>
        {dashIcon(done ? 'checkCircle' : skipped ? 'arrowRight' : 'clock', 15)}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14, textDecoration: closed ? 'line-through' : undefined, color: closed ? '#64748b' : '#0f172a' }}>{task.title || 'Untitled task'}</strong>
          <HrStatusPill tone={tone as 'ok'}>{pill}</HrStatusPill>
          {task.required && !closed && <HrStatusPill tone="orange">Required</HrStatusPill>}
          {task.ownerRole && <HrStatusPill tone="info">{roleLabel(task.ownerRole)}</HrStatusPill>}
        </div>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>
          {[task.dueDate ? `Due ${dmy(task.dueDate)}` : null, closed && task.completedAt ? `${done ? 'Done' : 'Skipped'} ${stamp(task.completedAt)}` : null].filter(Boolean).join(' · ') || 'No due date'}
        </span>
        {task.notes && <span style={{ fontSize: 12.5, color: '#475569', fontStyle: 'italic' }}>{task.notes}</span>}
        {canAct && !closed && (
          <div style={{ display: 'grid', gap: 8 }}>
            {noteOpen && <textarea aria-label={`Note for ${task.title || 'task'}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, saved with the task (or the reason for skipping)" rows={2} className="ut-input resize-none" />}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <HrButton size="sm" disabled={complete.isPending} onClick={() => run('complete')}>{complete.isPending ? 'Saving…' : 'Mark done'}</HrButton>
              {!noteOpen ? <HrButton size="sm" variant="ghost" onClick={() => setNoteOpen(true)}>Add note</HrButton>
                : <HrButton size="sm" variant="ghost" onClick={() => { setNoteOpen(false); setNote('') }}>Remove note</HrButton>}
              {!task.required && <HrButton size="sm" variant="ghost" disabled={skip.isPending} onClick={() => run('skip')}>Skip</HrButton>}
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
  const isHr = usePermission('hrms.onboarding.instance.write')
  const canAct = usePermission(P.HRMS_ONBOARDING_TASK_COMPLETE)
  const canReadEmployees = usePermission('hrms.employee.read')
  const { show, node } = useDesignToast()
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
    try { await updateStatus.mutateAsync({ instanceId: instance!.id, status: next }); show(msg); refetchInst() } catch (e) { show('Couldn’t update the onboarding', true, (e as Error)?.message) }
  }
  const back = <HrButton variant="ghost" onClick={() => navigate('/hrms/onboarding/instances')}>← {isHr ? 'All onboarding' : 'Back'}</HrButton>
  const hrAction = instance && isHr ? (
    instance.status === 'IN_PROGRESS' ? <HrButton variant="ghost" disabled={updateStatus.isPending} onClick={() => setStatus('ON_HOLD', 'Onboarding put on hold')}>Put on hold</HrButton>
      : instance.status === 'ON_HOLD' ? <HrButton disabled={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding resumed')}>Resume</HrButton>
        : instance.status === 'COMPLETED' ? <HrButton variant="ghost" disabled={updateStatus.isPending} onClick={() => setStatus('IN_PROGRESS', 'Onboarding reopened')}>Reopen</HrButton> : null
  ) : null
  return (
    <ModulePage crumb="Onboarding" title={title} subtitle={instance ? `Started ${dmy(instance.startedAt)}${instance.completedAt ? ` · completed ${dmy(instance.completedAt)}` : ''}` : undefined}
      actions={<>{back}{hrAction}</>}>
      {isLoading ? <State kind="loading" height={260} />
        : error ? <State kind="error" title="Couldn’t load this onboarding" description={(error as Error).message} onRetry={() => { refetchInst(); refetchTasks() }} />
          : !instance ? <State kind="empty" icon="clipboard" title="No onboarding found" description="It may have been removed, or it belongs to someone else." />
            : (
              <div style={{ display: 'grid', gap: 16 }}>
                {isHr && emp && (
                  <Panel title="New hire" aside={canReadEmployees ? <HrButton size="sm" variant="ghost" onClick={() => navigate(`/hrms/employees/${emp.id}`)}>Open profile</HrButton> : undefined}>
                    <HrAvatar name={name || 'Employee'} sub={[emp.employeeCode, emp.email].filter(Boolean).join(' · ')} />
                  </Panel>
                )}
                <Facts items={[
                  { k: 'Status', v: <HrStatusPill tone={statusTone(instance.status)}>{statusLabel(instance.status)}</HrStatusPill> },
                  { k: 'Progress', v: `${pct}%` },
                  { k: 'Done', v: String(done) },
                  { k: 'Still to do', v: String(open) },
                  ...(skipped ? [{ k: 'Skipped', v: String(skipped) }] : []),
                ]} />
                {tasks.length > 0 && (
                  <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: '#eef2f6', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#059669', borderRadius: 999, transition: 'width .4s' }} />
                  </div>
                )}
                {instance.status === 'ON_HOLD' && <Note tone="amber">HR has put this onboarding on hold.</Note>}
                {instance.status === 'IN_PROGRESS' && requiredOpen > 0 && <Note>{`${requiredOpen} required ${requiredOpen === 1 ? 'task is' : 'tasks are'} still open. The onboarding completes itself when every task is done or skipped.`}</Note>}
                <SubHeading>Checklist</SubHeading>
                {sorted.length === 0 ? <State kind="empty" icon="list" title="No tasks on this checklist" description="The template had no tasks when this onboarding started." />
                  : <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>{sorted.map((t) => <TaskItem key={t.id} task={t} instanceId={instance.id} canAct={canAct} toast={show} />)}</div>}
              </div>
            )}
      {node}
    </ModulePage>
  )
}
