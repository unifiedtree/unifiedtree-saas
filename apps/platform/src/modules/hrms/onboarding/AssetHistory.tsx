import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
interface Allocation {id:string;employeeId:string;employeeName:string;assignedAt:string;returnedAt?:string;notes?:string}
export function AssetHistory({assetId,tag,onClose}:{assetId:string;tag:string;onClose:()=>void}) {
 const query=useQuery({queryKey:['hrms','onboarding','assets','history',assetId],queryFn:()=>apiJson<Allocation[]>(`/v1/onboarding/assets/${assetId}/history`)})
 return <section aria-label="Asset allocation history" className="ut-card space-y-3 p-5"><div className="flex justify-between"><h2 className="font-semibold">Allocation history · {tag}</h2><HrButton variant="ghost" onClick={onClose}>Close history</HrButton></div>{query.isLoading?<p>Loading history...</p>:query.isError?<div role="alert"><p>{query.error.message}</p><HrButton onClick={()=>query.refetch()}>Retry</HrButton></div>:!query.data?.length?<p>No allocation history yet.</p>:<ol className="space-y-3">{query.data.map(a=><li key={a.id} className="border-l-2 border-primary pl-4 text-sm"><strong>{a.employeeName}</strong><p>Assigned {a.assignedAt} · {a.returnedAt?`Returned ${a.returnedAt}`:'Currently assigned'}</p>{a.notes&&<p className="text-text-secondary">{a.notes}</p>}</li>)}</ol>}</section>
}
