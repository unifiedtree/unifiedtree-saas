import { useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
interface Schedule { employeeId:string;employeeName:string;date:string;shiftName?:string;startTime?:string;endTime?:string }
export function TeamSchedule() {
  const allowed=usePermission('attendance.team.read')
  const [week,setWeek]=useState(startOfWeek(new Date(),{weekStartsOn:1})),[page,setPage]=useState(0)
  const from=format(week,'yyyy-MM-dd'),to=format(addDays(week,6),'yyyy-MM-dd')
  const query=useQuery({queryKey:['team','schedule',from,to],queryFn:()=>apiJson<Schedule[]>(`/v1/team/schedule?from=${from}&to=${to}`),enabled:allowed})
  const employees=[...new Map(query.data?.map(s=>[s.employeeId,s.employeeName])).entries()]
  if(!allowed)return null
  return <section className="ut-card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-semibold">Team shift roster</h2><p className="text-xs text-text-secondary">Effective shift assignments. Leave, holidays and weekly offs are shown in attendance.</p></div><div className="flex items-center gap-2"><HrButton variant="ghost" onClick={()=>{setWeek(addDays(week,-7));setPage(0)}}>Previous week</HrButton><span className="text-sm">{format(week,'d MMM')} – {format(addDays(week,6),'d MMM yyyy')}</span><HrButton variant="ghost" onClick={()=>{setWeek(addDays(week,7));setPage(0)}}>Next week</HrButton></div></div>
    {query.isLoading?<p className="p-5">Loading schedule...</p>:query.isError?<div role="alert" className="p-5"><p>{query.error.message}</p><HrButton onClick={()=>query.refetch()}>Retry</HrButton></div>:!employees.length?<p className="p-5">No employees in your team scope.</p>:<><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y border-border-default bg-bg-base"><th className="p-3 text-left">Employee</th>{Array.from({length:7},(_,i)=><th key={i} className="min-w-28 p-3 text-left">{format(addDays(week,i),'EEE d')}</th>)}</tr></thead><tbody>{employees.slice(page*10,page*10+10).map(([id,name])=><tr key={id} className="border-b border-border-default"><td className="p-3"><Link className="font-medium text-primary" to={`/hrms/employees/${id}`}>{name}</Link></td>{Array.from({length:7},(_,i)=>{const shift=query.data?.find(s=>s.employeeId===id&&s.date===format(addDays(week,i),'yyyy-MM-dd'));return <td className="p-3" key={i}><p>{shift?.shiftName||'Unassigned'}</p>{shift?.startTime&&<p className="text-xs text-text-secondary">{shift.startTime.slice(0,5)}–{shift.endTime?.slice(0,5)}</p>}</td>})}</tr>)}</tbody></table></div><div className="flex items-center justify-end gap-3 p-4"><HrButton variant="ghost" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</HrButton><span className="text-sm">{page+1} / {Math.ceil(employees.length/10)}</span><HrButton variant="ghost" disabled={(page+1)*10>=employees.length} onClick={()=>setPage(page+1)}>Next</HrButton></div></>}
  </section>
}
