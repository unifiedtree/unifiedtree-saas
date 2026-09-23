import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { useRuns, inr } from '../api/usePayrollRuns'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

function Notice({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  return loading ? <p role="status">Loading...</p> : error ? <div role="alert"><p>Unable to load this information.</p><HrButton variant="ghost" onClick={retry}>Retry</HrButton></div> : null
}
export function Performers({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ['admin-dashboard', 'performers', companyId], queryFn: () => apiJson<{ id: string; name: string; rating: number; reviews: number }[]>(`/v1/admin/dashboard/performers?companyId=${companyId}`), enabled: !!companyId })
  return <div className="space-y-3"><Notice loading={q.isLoading} error={q.isError} retry={() => q.refetch()} /><p className="text-xs text-text-secondary">Average rating across submitted reviews.</p>{q.data?.map(p => <Link key={p.id} to="/hrms/performance" className="flex justify-between rounded-lg bg-bg-base p-3"><span>{p.name}<small className="block text-text-secondary">{p.reviews} completed reviews</small></span><strong>{p.rating}/5</strong></Link>)}{q.data?.length === 0 && <p className="text-sm">No completed ratings yet.</p>}</div>
}
export function OnboardingTracker({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ['admin-dashboard', 'onboarding', companyId], queryFn: () => apiJson<{ id: string; name: string; status: string; completed: number; total: number }[]>(`/v1/admin/dashboard/onboarding?companyId=${companyId}`), enabled: !!companyId })
  return <div className="space-y-3"><Notice loading={q.isLoading} error={q.isError} retry={() => q.refetch()} />{q.data?.map(row => <Link key={row.id} to={`/hrms/onboarding/instances/${row.id}`} className="block rounded-lg p-2 hover:bg-bg-base"><div className="flex justify-between text-sm"><strong>{row.name}</strong><span>{row.completed}/{row.total} tasks</span></div><div className="mt-2 h-2 rounded bg-bg-base"><div className="h-2 rounded bg-primary" style={{ width: `${row.total ? row.completed / row.total * 100 : 0}%` }} /></div><p className="text-xs text-text-secondary">{row.status}</p></Link>)}{q.data?.length === 0 && <p className="text-sm">No onboarding runs in progress.</p>}<Link className="text-sm text-primary underline" to="/hrms/onboarding/instances">View all onboardings</Link></div>
}
export function HiringProgress({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ['admin-dashboard', 'hiring', companyId], queryFn: () => apiJson<{ openJobs: number; stages: { stage: string; count: number }[] }>(`/v1/admin/dashboard/hiring?companyId=${companyId}`), enabled: !!companyId })
  return <div className="space-y-3"><Notice loading={q.isLoading} error={q.isError} retry={() => q.refetch()} />{q.data && <><Link to="/hrms/hiring" className="block rounded-lg bg-bg-base p-4 text-center"><strong className="text-2xl">{q.data.openJobs}</strong><p className="text-sm">Open requisitions</p></Link><h3 className="font-semibold">Candidates by current stage</h3>{q.data.stages.map(s => <Link to="/hrms/hiring" key={s.stage} className="flex justify-between rounded-lg bg-primary/10 px-4 py-2 text-sm"><span>{s.stage}</span><strong>{s.count}</strong></Link>)}{!q.data.stages.length && <p>No candidates recorded.</p>}</>}</div>
}
export function PayrollTrend({ companyId }: { companyId: string }) {
  const q = useRuns({ companyId })
  const grouped = new Map<string, number>()
  for (const run of q.data || []) {
    if (run.status !== 'LOCKED' && run.status !== 'PAID') continue
    const month = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`
    grouped.set(month, (grouped.get(month) || 0) + run.totalGross)
  }
  const rows = [...grouped].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, gross]) => ({ month, gross }))
  return <div><Notice loading={q.isLoading} error={q.isError} retry={() => q.refetch()} />{!q.isLoading && !q.isError && (!rows.length ? <p>No finalized payroll runs.</p> : <><p className="mb-3 text-xs text-text-secondary">Gross payroll from locked and paid runs. Amounts in INR.</p><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows}><XAxis dataKey="month" /><YAxis /><Tooltip formatter={value => inr(Number(value))} /><Bar dataKey="gross" fill="var(--primary)" /></BarChart></ResponsiveContainer></div></>)}<Link className="text-sm text-primary underline" to="/hrms/payroll-dashboard">Open payroll</Link></div>
}
