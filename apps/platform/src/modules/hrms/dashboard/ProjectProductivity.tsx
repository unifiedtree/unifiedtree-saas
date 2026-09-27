// The projects drawer behind "Manage projects" (the Projects module is still coming soon): the three
// figures, pick a project, create one, change its status, and list / add / update its tasks. Kit fields and
// tokens only; same endpoints, query keys and labels as before.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { Button, EmptyState, ErrorState, MiniStat, MiniStatGrid, StatusPill } from '@/design/kit/display'
import { DateInput, Input, Select, useToast } from '@/design/kit/overlays'
import { fmtShort } from '@/design/dc/dates'

interface Project { id: string; name: string; status: string; total: number; completed: number }
interface Task { id: string; title: string; status: string; dueDate?: string }

const PROJECT_STATUS = ['ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => ({ value: s, label: s }))
const TASK_STATUS = ['PENDING', 'IN_PROGRESS', 'DONE'].map((s) => ({ value: s, label: s }))
const muted = { margin: 0, fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }

export function ProjectProductivity({ companyId }: { companyId: string }) {
  const canRead = usePermission('hrms.project.read'), canWrite = usePermission('hrms.project.write')
  const [name, setName] = useState(''), [selected, setSelected] = useState(''), [title, setTitle] = useState(''), [dueDate, setDueDate] = useState('')
  const qc = useQueryClient(), toast = useToast()
  const projects = useQuery({ queryKey: ['hrms', 'projects', companyId], queryFn: () => apiJson<Project[]>(`/v1/hrms/projects?companyId=${companyId}`), enabled: canRead && !!companyId })
  const tasks = useQuery({ queryKey: ['hrms', 'projects', 'tasks', selected], queryFn: () => apiJson<Task[]>(`/v1/hrms/projects/${selected}/tasks`), enabled: canRead && !!selected })
  const change = useMutation({
    mutationFn: ({ path, body, method = 'POST' }: { path: string; body: unknown; method?: string }) => apiJson(`/v1/hrms/projects${path}`, { method, body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hrms', 'projects'] }),
    onError: (e: Error) => { toast.error(e.message) },
  })
  if (!canRead) return <EmptyState variant="dashed" title="Project access is not enabled for your role." />
  const total = projects.data?.reduce((n, p) => n + p.total, 0) || 0, done = projects.data?.reduce((n, p) => n + p.completed, 0) || 0
  const current = projects.data?.find((p) => p.id === selected)

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <MiniStatGrid>
        <MiniStat label="Active projects" value={projects.data ? projects.data.filter((p) => p.status === 'ACTIVE').length : null} />
        <MiniStat label="Completed tasks" value={projects.data ? done : null} />
        <MiniStat label="Task completion" value={total ? `${Math.round((done / total) * 100)}%` : null} countUp={false} />
      </MiniStatGrid>

      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.isLoading ? (
        <p role="status" style={muted}>Loading projects…</p>
      ) : (
        <Select label="Project" value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="Select project"
          options={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.status}` }))} />
      )}

      {canWrite && (
        <form style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          onSubmit={async (e) => { e.preventDefault(); try { const p = await change.mutateAsync({ path: '', body: { companyId, name } }) as { id: string }; setSelected(p.id); setName('') } catch { /* the toast says why */ } }}>
          <Input aria-label="New project name" required maxLength={200} placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} fieldClassName="ud-grow" />
          <Button type="submit" variant="primary" disabled={change.isPending}>Create</Button>
        </form>
      )}

      {selected && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Tasks</h3>
            {canWrite && (
              <Select aria-label="Project status" value={current?.status || 'ACTIVE'} disabled={change.isPending} options={PROJECT_STATUS} fieldClassName="ud-narrow"
                onChange={(e) => change.mutate({ path: `/${selected}/status`, method: 'PUT', body: { status: e.target.value } })} />
            )}
          </div>
          {tasks.isError ? (
            <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : tasks.isLoading ? (
            <p role="status" style={muted}>Loading tasks…</p>
          ) : !tasks.data?.length ? (
            <p style={muted}>No tasks yet.</p>
          ) : (
            <div role="list" aria-label="Tasks">
              {tasks.data.map((t) => (
                <div key={t.id} role="listitem" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderTop: '1px solid var(--u-ln2,#EDF1EF)' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500 }}>{t.title}</p>
                    <p style={{ ...muted, fontSize: 12.5 }}>{t.dueDate ? `Due ${fmtShort(t.dueDate)}` : 'No due date'}</p>
                  </div>
                  {canWrite
                    ? <Select aria-label={`Status for ${t.title}`} value={t.status} disabled={change.isPending} options={TASK_STATUS} fieldClassName="ud-narrow"
                        onChange={(e) => change.mutate({ path: `/tasks/${t.id}/status`, method: 'PUT', body: { status: e.target.value } })} />
                    : <StatusPill tone="muted">{t.status}</StatusPill>}
                </div>
              ))}
            </div>
          )}
          {canWrite && (
            <form style={{ display: 'grid', gap: 10 }}
              onSubmit={async (e) => { e.preventDefault(); try { await change.mutateAsync({ path: `/${selected}/tasks`, body: { title, dueDate: dueDate || undefined } }); setTitle(''); setDueDate('') } catch { /* the toast says why */ } }}>
              <Input required maxLength={300} aria-label="Task title" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <DateInput label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} clearable />
              <div><Button type="submit" variant="primary" disabled={change.isPending}>Add task</Button></div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
