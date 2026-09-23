import { useState } from 'react'
import { format } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
interface Entry { id: string; workDate: string; description: string; minutes: number }
export function TimeEntries() {
  const allowed=usePermission('attendance.checkin.self'),qc=useQueryClient(),{toast}=useToast()
  const [date,setDate]=useState(format(new Date(),'yyyy-MM-dd')),[description,setDescription]=useState(''),[minutes,setMinutes]=useState(60),[editing,setEditing]=useState('')
  const [deleting,setDeleting]=useState('')
  const entries=useQuery({queryKey:['ess','time-entries',date],queryFn:()=>apiJson<Entry[]>(`/v1/ess/timesheets?from=${date}&to=${date}`),enabled:allowed&&!!date})
  const change=useMutation({mutationFn:({id,remove=false}:{id?:string;remove?:boolean})=>apiJson(`/v1/ess/timesheets${id?`/${id}`:''}`,{method:remove?'DELETE':id?'PUT':'POST',...(!remove?{body:JSON.stringify({workDate:date,description,minutes})}:{})}),onSuccess:()=>{qc.invalidateQueries({queryKey:['ess','time-entries']});setEditing('');setDeleting('');setDescription('');setMinutes(60)},onError:(e:Error)=>toast(e.message,'error')})
  if(!allowed)return null
  return <section className="ut-card space-y-4 p-5"><div><h2 className="font-semibold">Daily time entries</h2><p className="text-xs text-text-secondary">Record time spent on work. These entries do not change attendance punches or payroll.</p></div>
    <label className="block max-w-xs text-sm">Work date<input aria-label="Time entry date" type="date" required max={format(new Date(),'yyyy-MM-dd')} className="ut-input" value={date} onChange={e=>{setDate(e.target.value);setEditing('');setDescription('');setDeleting('')}} /></label>
    {entries.isLoading?<p>Loading time entries...</p>:entries.isError?<div role="alert"><p>{entries.error.message}</p><HrButton onClick={()=>entries.refetch()}>Retry</HrButton></div>:<><p className="text-sm font-medium">Total: {entries.data?.reduce((sum,e)=>sum+e.minutes,0)??0} minutes</p>{!entries.data?.length?<p className="text-sm text-text-secondary">No time recorded for this date.</p>:entries.data.map(entry=><div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default py-3"><div><p className="text-sm">{entry.description}</p><p className="text-xs text-text-secondary">{entry.minutes} minutes</p></div><div className="flex gap-2"><HrButton variant="ghost" disabled={change.isPending} onClick={()=>{setEditing(entry.id);setDescription(entry.description);setMinutes(entry.minutes)}}>Edit</HrButton><HrButton variant="ghost" disabled={change.isPending} onClick={()=>setDeleting(entry.id)}>Delete</HrButton></div>{deleting===entry.id&&<div role="alert" className="w-full text-sm">Delete this time entry?<div className="mt-2 flex gap-2"><HrButton disabled={change.isPending} onClick={()=>change.mutate({id:entry.id,remove:true})}>Confirm deletion</HrButton><HrButton variant="ghost" onClick={()=>setDeleting('')}>Keep entry</HrButton></div></div>}</div>)}</>}
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();change.mutate({id:editing||undefined})}}><label className="block text-sm">Work description<textarea aria-label="Work description" required maxLength={1000} className="ut-input" value={description} onChange={e=>setDescription(e.target.value)} /></label><label className="block max-w-xs text-sm">Minutes<input aria-label="Time entry minutes" type="number" min={1} max={1440} required className="ut-input" value={minutes} onChange={e=>setMinutes(Number(e.target.value))} /></label><div className="flex gap-2"><HrButton type="submit" disabled={change.isPending||!date}>{editing?'Save time entry':'Add time entry'}</HrButton>{editing&&<HrButton variant="ghost" onClick={()=>{setEditing('');setDescription('');setMinutes(60)}}>Cancel edit</HrButton>}</div></form>
  </section>
}
