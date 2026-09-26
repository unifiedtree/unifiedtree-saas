import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { useToast } from '@/shared/hooks/useToast'
interface Project { id: string; name: string; status: string; total: number; completed: number }
interface Task { id: string; title: string; status: string; dueDate?: string }
export function ProjectProductivity({ companyId }: { companyId: string }) {
  const canRead=usePermission('hrms.project.read'),canWrite=usePermission('hrms.project.write')
  const [name,setName]=useState(''),[selected,setSelected]=useState(''),[title,setTitle]=useState(''),[dueDate,setDueDate]=useState('')
  const qc=useQueryClient(),{toast}=useToast()
  const projects=useQuery({queryKey:['hrms','projects',companyId],queryFn:()=>apiJson<Project[]>(`/v1/hrms/projects?companyId=${companyId}`),enabled:canRead&&!!companyId})
  const tasks=useQuery({queryKey:['hrms','projects','tasks',selected],queryFn:()=>apiJson<Task[]>(`/v1/hrms/projects/${selected}/tasks`),enabled:canRead&&!!selected})
  const change=useMutation({mutationFn:({path,body,method='POST'}:{path:string;body:unknown;method?:string})=>apiJson(`/v1/hrms/projects${path}`,{method,body:JSON.stringify(body)}),onSuccess:()=>qc.invalidateQueries({queryKey:['hrms','projects']}),onError:(e:Error)=>toast(e.message,'error')})
  if(!canRead)return <p className="text-sm text-text-secondary">Project access is not enabled for your role.</p>
  const total=projects.data?.reduce((n,p)=>n+p.total,0)||0,done=projects.data?.reduce((n,p)=>n+p.completed,0)||0
  return <div className="space-y-4"><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-bg-base p-3"><strong className="block text-xl">{projects.data?.filter(p=>p.status==='ACTIVE').length??'—'}</strong><span className="text-xs">Active projects</span></div><div className="rounded-lg bg-bg-base p-3"><strong className="block text-xl">{projects.data?done:'—'}</strong><span className="text-xs">Completed tasks</span></div><div className="rounded-lg bg-bg-base p-3"><strong className="block text-xl">{total?Math.round(done/total*100)+'%':'—'}</strong><span className="text-xs">Task completion</span></div></div>
    {projects.isError?<div role="alert"><p>{projects.error.message}</p><HrButton onClick={()=>projects.refetch()}>Retry</HrButton></div>:projects.isLoading?<p>Loading projects...</p>:<label className="block text-sm">Project<select aria-label="Project" className="ut-select" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select project</option>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}</select></label>}
    {canWrite&&<form className="flex gap-2" onSubmit={async e=>{e.preventDefault();try{const p=await change.mutateAsync({path:'',body:{companyId,name}}) as {id:string};setSelected(p.id);setName('')}catch{}}}><input aria-label="New project name" required maxLength={200} className="ut-input" placeholder="New project name" value={name} onChange={e=>setName(e.target.value)}/><HrButton type="submit" disabled={change.isPending}>Create</HrButton></form>}
    {selected&&<><div className="flex items-center justify-between"><h3 className="font-semibold">Tasks</h3>{canWrite&&<select aria-label="Project status" className="ut-select max-w-40" value={projects.data?.find(p=>p.id===selected)?.status||'ACTIVE'} disabled={change.isPending} onChange={e=>change.mutate({path:`/${selected}/status`,method:'PUT',body:{status:e.target.value}})}>{['ACTIVE','COMPLETED','CANCELLED'].map(s=><option key={s}>{s}</option>)}</select>}</div>
      {tasks.isError?<div role="alert"><p>{tasks.error.message}</p><HrButton onClick={()=>tasks.refetch()}>Retry</HrButton></div>:tasks.isLoading?<p>Loading tasks...</p>:!tasks.data?.length?<p className="text-sm">No tasks yet.</p>:tasks.data.map(t=><div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default py-2"><div><p className="text-sm">{t.title}</p><p className="text-xs text-text-secondary">{t.dueDate?`Due ${t.dueDate}`:'No due date'}</p></div>{canWrite?<select aria-label={`Status for ${t.title}`} className="ut-select max-w-40" value={t.status} disabled={change.isPending} onChange={e=>change.mutate({path:`/tasks/${t.id}/status`,method:'PUT',body:{status:e.target.value}})}>{['PENDING','IN_PROGRESS','DONE'].map(s=><option key={s}>{s}</option>)}</select>:<HrStatusPill tone="gray">{t.status}</HrStatusPill>}</div>)}
      {canWrite&&<form className="space-y-2" onSubmit={async e=>{e.preventDefault();try{await change.mutateAsync({path:`/${selected}/tasks`,body:{title,dueDate:dueDate||undefined}});setTitle('');setDueDate('')}catch{}}}><input required maxLength={300} aria-label="Task title" placeholder="Task title" className="ut-input" value={title} onChange={e=>setTitle(e.target.value)}/><label className="block text-sm">Due date<DateField className="ut-input" value={dueDate} onChange={e=>setDueDate(e.target.value)} clearable/></label><HrButton type="submit" disabled={change.isPending}>Add task</HrButton></form>}
    </>}
  </div>
}
