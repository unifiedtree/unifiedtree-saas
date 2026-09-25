// Geofencing (/hrms/attendance/geofencing), on the module kit: the places
// staff can punch in from the mobile app. Listing needs attendance.team.read;
// add / edit / remove need org.geofence.write (the backend enforces both).
// The list shows active zones only; "Remove" deactivates a zone, which then
// stops being used for punches and leaves the list.
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrStatusPill, HrButton, HrDrawer } from '@/shared/components/hr'
import { ModulePage, State, Note, StatRow, CARD, HEAD_FONT, useDesignToast } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useCompanies, useDepartments, useBranches } from '../api/useOrg'
import { useGeofenceZones, useCreateGeofenceZone, useUpdateGeofenceZone, useDeleteGeofenceZone, type GeoFenceZone, type GeoFenceZonePayload } from '../api/useGeofence'
// Lazy: Leaflet and its CSS are ~158 kB and only this screen uses them.
const LocationMapPicker = React.lazy(() => import('./LocationMapPicker').then((m) => ({ default: m.LocationMapPicker })))

// Must match the mobile Geofence Zones palette, or a zone made on a phone shows a colour the web can't pick.
const COLOR_PRESETS = ['#0F6E56', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899']
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
type Toast = (msg: string, err?: boolean, detail?: string) => void

interface ZoneForm { name: string; latitude: string; longitude: string; radiusMeters: string; branchId: string; departmentId: string; punchMethod: string; colorHex: string }
// punch_method is NOT NULL but read by nothing at check-in, so it's kept as-is and not offered as a choice.
const emptyForm = (): ZoneForm => ({ name: '', latitude: '', longitude: '', radiusMeters: '100', branchId: '', departmentId: '', punchMethod: 'FACE_RECOGNITION', colorHex: COLOR_PRESETS[0] })
const formFromZone = (z: GeoFenceZone): ZoneForm => ({
  name: z.name ?? '', latitude: z.latitude != null ? String(z.latitude) : '', longitude: z.longitude != null ? String(z.longitude) : '',
  radiusMeters: z.radiusMeters != null ? String(z.radiusMeters) : '100', branchId: z.branchId ?? '', departmentId: z.departmentId ?? '',
  punchMethod: z.punchMethod ?? 'FACE_RECOGNITION', colorHex: z.colorHex ?? COLOR_PRESETS[0],
})

function ZoneDrawer({ editing, onClose, toast }: { editing: GeoFenceZone | null; onClose: () => void; toast: Toast }) {
  const createZone = useCreateGeofenceZone()
  const updateZone = useUpdateGeofenceZone()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)
  const { data: branches = [] } = useBranches(companyId)
  const [form, setForm] = useState<ZoneForm>(() => (editing ? formFromZone(editing) : emptyForm()))
  // Bumped when the coordinates change from outside the map (not on a map click) so the view follows.
  const [recenterKey, setRecenterKey] = useState(1)
  const set = (k: keyof ZoneForm, v: string) => setForm((p) => ({ ...p, [k]: v }))
  const busy = createZone.isPending || updateZone.isPending
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { toast('This browser can’t share its location', true); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => { set('latitude', pos.coords.latitude.toFixed(6)); set('longitude', pos.coords.longitude.toFixed(6)); setRecenterKey((k) => k + 1) },
      () => toast('Couldn’t get your location', true),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }
  const submit = async () => {
    if (!form.name.trim()) { toast('Name the zone', true); return }
    const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude), radius = parseInt(form.radiusMeters, 10)
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { toast('Set a valid location on the map or in the boxes', true); return }
    if (Number.isNaN(radius) || radius <= 0) { toast('The radius must be a positive number of metres', true); return }
    const payload: GeoFenceZonePayload = { name: form.name.trim(), latitude: lat, longitude: lng, radiusMeters: radius, branchId: form.branchId || undefined, departmentId: form.departmentId || undefined, punchMethod: form.punchMethod || undefined, colorHex: form.colorHex, active: true }
    try {
      if (editing) { await updateZone.mutateAsync({ id: editing.id, ...payload }); toast('Zone saved') } else { await createZone.mutateAsync(payload); toast('Zone added') }
      onClose()
    } catch (err) { toast('Couldn’t save the zone', true, (err as Error)?.message) }
  }
  return (
    <HrDrawer title={editing ? `Edit ${editing.name}` : 'Add a zone'} onClose={() => { if (!busy) onClose() }} width="max-w-xl"
      footer={<><HrButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</HrButton><HrButton onClick={submit} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save zone' : 'Add zone'}</HrButton></>}>
      <div className="space-y-4">
        <div><label className={label} htmlFor="gz-name">Zone name</label><input id="gz-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Hyderabad HQ" className="ut-input" /></div>
        {/* Two-way bound: typing moves the pin, moving the pin rewrites the boxes. */}
        <React.Suspense fallback={<div className="h-[260px] animate-pulse rounded-xl border border-border-default bg-bg-base" />}>
          <LocationMapPicker lat={Number(form.latitude)} lng={Number(form.longitude)} radiusMeters={Number(form.radiusMeters)} recenterKey={recenterKey}
            onChange={(la, ln) => { set('latitude', la.toFixed(6)); set('longitude', ln.toFixed(6)) }} />
        </React.Suspense>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div><label className={label} htmlFor="gz-lat">Latitude</label><input id="gz-lat" value={form.latitude} onChange={(e) => { set('latitude', e.target.value); setRecenterKey((k) => k + 1) }} placeholder="17.385044" inputMode="decimal" className="ut-input" /></div>
          <div><label className={label} htmlFor="gz-lng">Longitude</label><input id="gz-lng" value={form.longitude} onChange={(e) => { set('longitude', e.target.value); setRecenterKey((k) => k + 1) }} placeholder="78.486671" inputMode="decimal" className="ut-input" /></div>
        </div>
        <HrButton size="sm" variant="ghost" onClick={useCurrentLocation}>{dashIcon('target', 14)} Use my current location</HrButton>
        <div><label className={label} htmlFor="gz-radius">Radius (metres)</label><input id="gz-radius" type="number" min={1} value={form.radiusMeters} onChange={(e) => set('radiusMeters', e.target.value)} placeholder="100" className="ut-input" /></div>
        <div><label className={label} htmlFor="gz-branch">Branch</label>
          <select id="gz-branch" value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className="ut-select">
            <option value="">None (company-wide)</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-text-tertiary">People assigned to this zone show under this branch in the directory when their own branch is blank.</p>
        </div>
        <div><label className={label} htmlFor="gz-dept">Department</label>
          <select id="gz-dept" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} className="ut-select">
            <option value="">None (company-wide)</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {departments.length === 0 && <p className="mt-1 text-xs text-text-tertiary">No departments yet; add one under Organization first.</p>}
        </div>
        <Note>Punching here always needs both: being inside the zone (GPS) and passing the face check.</Note>
        <div><span className={label}>Colour on the map</span>
          <div className="flex flex-wrap gap-2.5">
            {COLOR_PRESETS.map((c) => (
              <button key={c} type="button" onClick={() => set('colorHex', c)} aria-label={`Colour ${c}`} aria-pressed={form.colorHex === c}
                style={{ width: 32, height: 32, borderRadius: 999, background: c, border: 0, cursor: 'pointer', color: '#fff', fontWeight: 800, boxShadow: form.colorHex === c ? '0 0 0 2px #fff, 0 0 0 4px #0f172a' : 'none' }}>
                {form.colorHex === c ? '✓' : ''}
              </button>
            ))}
          </div>
        </div>
      </div>
    </HrDrawer>
  )
}

export const GeofenceZones: React.FC = () => {
  const { show, node } = useDesignToast()
  const canWrite = usePermission(P.ORG_GEOFENCE_WRITE)
  const { data: zones = [], isLoading, error, refetch } = useGeofenceZones()
  const deleteZone = useDeleteGeofenceZone()
  const [drawer, setDrawer] = useState<{ zone: GeoFenceZone | null } | null>(null)
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)
  const { data: branches = [] } = useBranches(companyId)
  const names = useMemo(() => ({ dept: new Map(departments.map((d) => [d.id, d.name])), branch: new Map(branches.map((b) => [b.id, b.name])) }), [departments, branches])
  const remove = async (z: GeoFenceZone) => {
    if (!window.confirm(`Remove “${z.name}”? It stops being used for punches and leaves this list.`)) return
    try { await deleteZone.mutateAsync(z.id); show('Zone removed') } catch (err) { show('Couldn’t remove the zone', true, (err as Error)?.message) }
  }
  const covered = zones.filter((z) => z.branchId).length
  return (
    <ModulePage crumb="Attendance" title="Geofencing" subtitle="The places staff can punch in from the mobile app."
      actions={canWrite ? <HrButton onClick={() => setDrawer({ zone: null })}><Plus size={15} /> Add zone</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {!canWrite && <Note>View only. Ask an admin or HR manager to add, change or remove zones.</Note>}
        {isLoading ? <State kind="loading" height={96} /> : !error && zones.length > 0 && <StatRow tiles={[
          { icon: 'target', color: 'green', label: 'Active zones', value: String(zones.length), sub: 'Used for punches' },
          { icon: 'briefcase', color: 'blue', label: 'Tied to a branch', value: String(covered), sub: `${zones.length - covered} company-wide` },
        ]} />}
        {isLoading ? <State kind="loading" height={200} />
          : error ? <State kind="error" title="Couldn’t load the zones" description={(error as Error)?.message} onRetry={() => refetch()} />
            : zones.length === 0 ? <State kind="empty" icon="target" title="No zones yet" description={canWrite ? 'Add your office locations so staff can punch in from the app.' : 'Zones HR sets up appear here.'} />
              : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 12 }}>
                  {zones.map((z) => (
                    <article key={z.id} style={{ ...CARD, padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 999, background: z.colorHex || '#0F6E56', flexShrink: 0 }} />
                        <h3 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: HEAD_FONT, fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.name}</h3>
                        <HrStatusPill tone={z.active ? 'ok' : 'gray'}>{z.active ? 'Active' : 'Inactive'}</HrStatusPill>
                      </div>
                      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 13 }}>
                        <dt style={{ color: '#64748b' }}>Centre</dt><dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{`${z.latitude.toFixed(5)}, ${z.longitude.toFixed(5)}`}</dd>
                        <dt style={{ color: '#64748b' }}>Radius</dt><dd style={{ margin: 0 }}>{`${z.radiusMeters} m`}</dd>
                        <dt style={{ color: '#64748b' }}>Branch</dt><dd style={{ margin: 0 }}>{z.branchId ? names.branch.get(z.branchId) ?? 'Assigned' : 'Company-wide'}</dd>
                        <dt style={{ color: '#64748b' }}>Department</dt><dd style={{ margin: 0 }}>{z.departmentId ? names.dept.get(z.departmentId) ?? 'Assigned' : 'Any'}</dd>
                        <dt style={{ color: '#64748b' }}>Check</dt><dd style={{ margin: 0 }}>GPS and face</dd>
                      </dl>
                      <a href={`https://www.openstreetmap.org/?mlat=${z.latitude}&mlon=${z.longitude}#map=17/${z.latitude}/${z.longitude}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: '#0f6e56', textDecoration: 'none' }}>View on a map ↗</a>
                      {canWrite && (
                        <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                          <HrButton size="sm" variant="ghost" onClick={() => setDrawer({ zone: z })}>Edit</HrButton>
                          <HrButton size="sm" variant="ghost" disabled={deleteZone.isPending} onClick={() => remove(z)}>Remove</HrButton>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
      </div>
      {drawer && <ZoneDrawer key={drawer.zone?.id ?? 'new'} editing={drawer.zone} onClose={() => setDrawer(null)} toast={show} />}
      {node}
    </ModulePage>
  )
}
