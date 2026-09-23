import React, { Suspense, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies, useBranches, type Branch, type Company } from '../api/useOrg'
import { CompaniesTab, BranchesTab } from './OrgSetup'
const LocationMapPicker = React.lazy(() => import('../attendance/LocationMapPicker').then(m => ({ default: m.LocationMapPicker })))
function BranchGeofence({ branch }: { branch: Branch }) {
  const canWrite = usePermission('org.geofence.write'), qc = useQueryClient(), { toast } = useToast()
  const [latitude, setLatitude] = useState(String(branch.latitude ?? ''))
  const [longitude, setLongitude] = useState(String(branch.longitude ?? ''))
  const [radius, setRadius] = useState(branch.geoFenceRadiusMeters ?? 100)
  const [enforced, setEnforced] = useState(branch.geoFenceEnforced)
  const [recenter, setRecenter] = useState(0)
  const valid = latitude.trim() !== '' && longitude.trim() !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180
  const save = useMutation({ mutationFn: () => apiJson(`/v1/hrms/branches/${branch.id}/geofence`, { method: 'PUT', body: JSON.stringify({ latitude: Number(latitude), longitude: Number(longitude), radiusMeters: radius, enforced }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['hrms', 'branches'] }); toast('Branch geofence saved', 'success') }, onError: (e: Error) => toast(e.message, 'error') })
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); if(valid) save.mutate() }}>
    <p className="text-sm text-text-secondary">Set the permitted attendance area for {branch.name}. Coordinates and enforcement are saved to this branch.</p>
    <fieldset disabled={!canWrite || save.isPending} className="space-y-4">
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={enforced} onChange={e => setEnforced(e.target.checked)} />Enforce geofence</label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm">Latitude<input aria-label="Latitude" className="ut-input" type="number" step="any" min={-90} max={90} required value={latitude} onChange={e => { setLatitude(e.target.value); setRecenter(v => v + 1) }} /></label><label className="text-sm">Longitude<input aria-label="Longitude" className="ut-input" type="number" step="any" min={-180} max={180} required value={longitude} onChange={e => { setLongitude(e.target.value); setRecenter(v => v + 1) }} /></label></div>
      <label className="block text-sm">Radius (metres)<input aria-label="Radius (metres)" className="ut-input" type="number" min={1} max={100000} required value={radius} onChange={e => setRadius(Number(e.target.value))} /></label>
    </fieldset>
    {valid && <Suspense fallback={<p>Loading map...</p>}><LocationMapPicker lat={Number(latitude)} lng={Number(longitude)} radiusMeters={radius} recenterKey={recenter} onChange={(lat,lng) => { if(canWrite) { setLatitude(String(lat)); setLongitude(String(lng)) } }} /></Suspense>}
    {canWrite && <HrButton type="submit" disabled={!valid || save.isPending}>Save geofence</HrButton>}
  </form>
}
function BranchesAndGeofence({ company }: { company: Company }) {
  const companyId = company.id
  const branches = useBranches(companyId), [selected, setSelected] = useState('')
  const branch = branches.data?.find(b => b.id === selected) ?? branches.data?.[0]
  return <div className="grid items-start gap-6 xl:grid-cols-[3fr_2fr]"><section className="ut-card min-w-0 p-5"><h2 className="mb-4 text-lg font-semibold">Branches</h2><BranchesTab activeCompany={company} /></section><section className="ut-card space-y-4 p-5"><h2 className="text-lg font-semibold">Branch geofence</h2>{branches.isLoading ? <p>Loading branches...</p> : branches.isError ? <div role="alert"><p>{branches.error.message}</p><HrButton onClick={() => branches.refetch()}>Retry</HrButton></div> : !branch ? <p>Create a branch to configure its attendance area.</p> : <><select aria-label="Geofence branch" className="ut-select" value={branch.id} onChange={e => setSelected(e.target.value)}>{branches.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><BranchGeofence key={branch.id} branch={branch} /></>}</section></div>
}
export const Companies: React.FC = () => {
  const companies = useCompanies(), [selected, setSelected] = useState('')
  const companyId = companies.data?.find(c => c.id === selected)?.id ?? companies.data?.[0]?.id
  return <div className="mx-auto max-w-[1680px] space-y-6 p-4 sm:p-6 lg:p-8"><div><h1 className="text-2xl font-semibold">Companies & Branches</h1><p className="mt-1 text-sm text-text-secondary">Manage company records, offices and attendance boundaries.</p></div><section className="ut-card p-5"><CompaniesTab /></section><label className="block max-w-sm text-sm">Company<select aria-label="Company" className="ut-select" value={companyId ?? ''} onChange={e => setSelected(e.target.value)}>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{companyId && <BranchesAndGeofence key={companyId} company={companies.data!.find(c => c.id === companyId)!} />}</div>
}
