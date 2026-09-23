import { useQuery } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
interface Stats {activeEmployees?:number;openRoles?:number;complianceScore?:number|null;complianceDue?:number;complianceCompleted?:number;monthlyPayroll?:number|null;month:string}
interface Alert {type:string;count:number;label:string;path:string}
export function CompanySummary({companyId}:{companyId:string}) {
 const allowed=usePermission('org.company.read'),navigate=useNavigate()
 const stats=useQuery({queryKey:['dashboard','summary',companyId],queryFn:()=>apiJson<Stats>(`/v1/admin/dashboard/stats?companyId=${companyId}`),enabled:allowed&&!!companyId})
 const alerts=useQuery({queryKey:['dashboard','alerts',companyId],queryFn:()=>apiJson<Alert[]>('/v1/admin/dashboard/alerts'),enabled:allowed&&!!companyId})
 if(!allowed)return null
 return <section aria-label="Company summary" className="space-y-4"><h2 className="dashboard-section-title">Company summary</h2>{stats.isLoading?<p>Loading company summary...</p>:stats.isError?<div role="alert"><p>{stats.error.message}</p><HrButton onClick={()=>stats.refetch()}>Retry summary</HrButton></div>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
 {stats.data?.activeEmployees!==undefined&&<button className="ut-card p-5 text-left" onClick={()=>navigate('/hrms/employees?status=ACTIVE')}><p className="text-sm">Active employees</p><strong className="block text-2xl">{stats.data.activeEmployees}</strong></button>}
 {stats.data?.openRoles!==undefined&&<button className="ut-card p-5 text-left" onClick={()=>navigate('/hrms/hiring')}><p className="text-sm">Open roles</p><strong className="block text-2xl">{stats.data.openRoles}</strong></button>}
 {stats.data?.complianceDue!==undefined&&<button className="ut-card p-5 text-left" onClick={()=>navigate('/hrms/compliance')}><p className="text-sm">Compliance completion</p><strong className="block text-2xl">{stats.data.complianceScore==null?'No items due':`${stats.data.complianceScore}%`}</strong><p className="mt-1 text-xs text-text-secondary">{stats.data.complianceCompleted} of {stats.data.complianceDue} obligations due this month through today completed</p></button>}
 {stats.data&&'monthlyPayroll' in stats.data&&<button className="ut-card p-5 text-left" onClick={()=>navigate('/hrms/payroll/runs')}><p className="text-sm">Finalized payroll · {stats.data.month}</p><strong className="block text-xl">{stats.data.monthlyPayroll==null?'Not finalized':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(stats.data.monthlyPayroll)}</strong><p className="mt-1 text-xs text-text-secondary">Gross amount from locked or paid payroll</p></button>}
 </div>}
 {alerts.isError?<div role="alert"><p>{alerts.error.message}</p><HrButton onClick={()=>alerts.refetch()}>Retry alerts</HrButton></div>:alerts.isLoading?<p>Loading pending actions...</p>:<div className="flex flex-wrap gap-3">{alerts.data?.map(a=><button key={a.type} className="ut-card px-4 py-3 text-left text-sm" onClick={()=>navigate(a.path)}><strong>{a.count}</strong> {a.label} →</button>)}</div>}
 </section>
}
