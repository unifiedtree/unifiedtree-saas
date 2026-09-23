import { useState } from 'react'
import { format, endOfMonth } from 'date-fns'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
interface Overtime { id:string;employeeId:string;employeeName:string;date:string;minutes:number;status:string;note?:string;decidedBy?:string }
export function OvertimeApprovals() {
 const canRead=usePermission('attendance.team.read'),canApprove=usePermission('attendance.overtime.approve'),qc=useQueryClient(),{toast}=useToast()
 const [month,setMonth]=useState(format(new Date(),'yyyy-MM')),[page,setPage]=useState(0),[selected,setSelected]=useState(''),[note,setNote]=useState('')
 const query=useQuery({queryKey:['attendance','overtime',month,page],queryFn:()=>apiJson<{content:Overtime[];totalElements:number}>(`/v1/attendance/overtime?from=${month}-01&to=${format(endOfMonth(new Date(month+'-01T12:00:00')),'yyyy-MM-dd')}&page=${page}`),enabled:canRead&&!!month})
 const decision=useMutation({mutationFn:(action:'approve'|'reject')=>apiJson(`/v1/attendance/overtime/${selected}/${action}`,{method:'POST',body:JSON.stringify({note})}),onSuccess:()=>{qc.invalidateQueries({queryKey:['attendance','overtime']});setSelected('');setNote('')},onError:(e:Error)=>toast(e.message,'error')})
 if(!canRead)return null
 return <section className="ut-card space-y-4 p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Overtime approvals</h2><p className="text-xs text-text-secondary">Review completed attendance records. Approval records the decision; payroll disbursement is a separate workflow.</p></div><input aria-label="Overtime month" type="month" className="ut-input max-w-48" value={month} onChange={e=>{setMonth(e.target.value);setPage(0);setSelected('')}} /></div>
 {query.isLoading?<p>Loading overtime...</p>:query.isError?<div role="alert"><p>{query.error.message}</p><HrButton onClick={()=>query.refetch()}>Retry</HrButton></div>:!query.data?.content.length?<p className="text-sm">No completed overtime records for this month.</p>:<div className="overflow-x-auto"><table className="hr-table"><thead><tr><th>Employee</th><th>Date</th><th>Minutes</th><th>Status</th><th>Review</th></tr></thead><tbody>{query.data.content.map(row=><tr key={row.id}><td><Link className="text-primary" to={`/hrms/employees/${row.employeeId}`}>{row.employeeName}</Link></td><td>{row.date}</td><td>{row.minutes}</td><td><HrStatusPill tone={row.status==='APPROVED'?'ok':row.status==='REJECTED'?'red':'warn'}>{row.status}</HrStatusPill></td><td>{row.status==='PENDING'&&canApprove?<HrButton onClick={()=>{setSelected(row.id);setNote('')}}>Review</HrButton>:<><p className="text-xs">{row.decidedBy}</p><p className="text-xs text-text-secondary">{row.note}</p></>}</td></tr>)}</tbody></table></div>}
 {selected&&<div role="region" aria-label="Overtime decision" className="space-y-3 rounded-xl border border-border-default p-4"><p className="text-sm font-medium">Review overtime for {query.data?.content.find(r=>r.id===selected)?.employeeName}</p><label className="block text-sm">Decision note<textarea className="ut-input" maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} /></label><div className="flex gap-2"><HrButton disabled={decision.isPending} onClick={()=>decision.mutate('approve')}>Approve overtime</HrButton><HrButton variant="ghost" disabled={decision.isPending||!note.trim()} onClick={()=>decision.mutate('reject')}>Reject overtime</HrButton><HrButton variant="ghost" onClick={()=>setSelected('')}>Cancel</HrButton></div></div>}
 {!!query.data?.totalElements&&<div className="flex justify-end gap-3"><HrButton disabled={!page} onClick={()=>{setPage(page-1);setSelected('')}}>Previous</HrButton><span className="self-center text-sm">{page+1} / {Math.ceil(query.data.totalElements/20)}</span><HrButton disabled={(page+1)*20>=query.data.totalElements} onClick={()=>{setPage(page+1);setSelected('')}}>Next</HrButton></div>}
 </section>
}
