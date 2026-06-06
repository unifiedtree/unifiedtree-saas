import React, { useMemo, useState } from 'react'
import { MapPin, Plus, Pencil, Trash2, X, Crosshair, Radius } from 'lucide-react'
import { clsx } from 'clsx'
import { usePermission, P } from '@unifiedtree/sdk'
import { Badge, EmptyState, Skeleton } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies, useDepartments } from '../api/useOrg'
import {
  useGeofenceZones, useCreateGeofenceZone, useUpdateGeofenceZone, useDeleteGeofenceZone,
  type GeoFenceZone, type GeoFenceZonePayload,
} from '../api/useGeofence'

// Mirrors the mobile geofence CRUD (Attendance_App/app/geofence-zones.tsx) for
// behaviour. Write actions are gated on org.geofence.write — the same authority
// the backend enforces (@PreAuthorize) on POST/PUT/DELETE.

const COLOR_PRESETS = ['#0F6E56', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899']
const PUNCH_METHODS = ['FACE_RECOGNITION', 'GPS', 'MANUAL'] as const

interface ZoneFormState {
  name: string
  latitude: string
  longitude: string
  radiusMeters: string
  departmentId: string
  punchMethod: string
  colorHex: string
}

function emptyForm(): ZoneFormState {
  return {
    name: '', latitude: '', longitude: '', radiusMeters: '100',
    departmentId: '', punchMethod: 'FACE_RECOGNITION', colorHex: COLOR_PRESETS[0],
  }
}

function formFromZone(z: GeoFenceZone): ZoneFormState {
  return {
    name: z.name ?? '',
    latitude: z.latitude != null ? String(z.latitude) : '',
    longitude: z.longitude != null ? String(z.longitude) : '',
    radiusMeters: z.radiusMeters != null ? String(z.radiusMeters) : '100',
    departmentId: z.departmentId ?? '',
    punchMethod: z.punchMethod ?? 'FACE_RECOGNITION',
    colorHex: z.colorHex ?? COLOR_PRESETS[0],
  }
}

// ── Slide-over form ─────────────────────────────────────────────────────────────

function ZoneFormModal({
  open, onClose, editing, canWrite,
}: {
  open: boolean
  onClose: () => void
  editing: GeoFenceZone | null
  canWrite: boolean
}) {
  const { toast } = useToast()
  const createZone = useCreateGeofenceZone()
  const updateZone = useUpdateGeofenceZone()
  const isEditing = !!editing

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)

  const [form, setForm] = useState<ZoneFormState>(emptyForm())
  // Re-seed the form whenever the modal opens for a different zone.
  const seedKey = (open ? 'open' : 'closed') + ':' + (editing?.id ?? 'new')
  const [seededKey, setSeededKey] = useState('')
  if (open && seededKey !== seedKey) {
    setForm(editing ? formFromZone(editing) : emptyForm())
    setSeededKey(seedKey)
  }
  if (!open && seededKey !== '') setSeededKey('')

  const set = (k: keyof ZoneFormState, v: string) => setForm((p) => ({ ...p, [k]: v }))
  const isPending = createZone.isPending || updateZone.isPending

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { toast('Geolocation is not available in this browser', 'error'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set('latitude', pos.coords.latitude.toFixed(6))
        set('longitude', pos.coords.longitude.toFixed(6))
      },
      () => toast('Could not get current location', 'error'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast('Zone name is required', 'error'); return }
    const lat = parseFloat(form.latitude)
    const lng = parseFloat(form.longitude)
    const radius = parseInt(form.radiusMeters, 10)
    if (Number.isNaN(lat) || Number.isNaN(lng)) { toast('Valid latitude and longitude are required', 'error'); return }
    if (Number.isNaN(radius) || radius <= 0) { toast('Radius must be a positive number', 'error'); return }

    const payload: GeoFenceZonePayload = {
      name: form.name.trim(),
      latitude: lat,
      longitude: lng,
      radiusMeters: radius,
      departmentId: form.departmentId || undefined,
      punchMethod: form.punchMethod || undefined,
      colorHex: form.colorHex,
      active: true,
    }

    try {
      if (isEditing) {
        await updateZone.mutateAsync({ id: editing!.id, ...payload })
        toast('Zone updated', 'success')
      } else {
        await createZone.mutateAsync(payload)
        toast('Zone created', 'success')
      }
      onClose()
    } catch (err) {
      toast((err as Error)?.message || 'Failed to save zone', 'error')
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-text-primary/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-border-default flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h3 className="text-text-primary font-semibold">{isEditing ? 'Edit Zone' : 'Add Zone'}</h3>
          <button onClick={onClose} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Zone Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Hyderabad HQ"
              className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Latitude *</label>
              <input
                value={form.latitude}
                onChange={(e) => set('latitude', e.target.value)}
                placeholder="17.385044"
                inputMode="decimal"
                className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Longitude *</label>
              <input
                value={form.longitude}
                onChange={(e) => set('longitude', e.target.value)}
                placeholder="78.486671"
                inputMode="decimal"
                className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={useCurrentLocation}
            className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary-dark transition-colors"
          >
            <Crosshair size={14} /> Use my current location
          </button>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Radius (meters) *</label>
            <input
              value={form.radiusMeters}
              onChange={(e) => set('radiusMeters', e.target.value)}
              placeholder="100"
              inputMode="numeric"
              className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Assign to Department</label>
            <select
              value={form.departmentId}
              onChange={(e) => set('departmentId', e.target.value)}
              className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
            >
              <option value="">None (company-wide)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Punch Method</label>
            <div className="flex flex-wrap gap-2">
              {PUNCH_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('punchMethod', m)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    form.punchMethod === m
                      ? 'border-primary bg-primary-light text-primary'
                      : 'border-border-default bg-surface text-text-secondary hover:text-text-primary'
                  )}
                >
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Zone Color</label>
            <div className="flex flex-wrap gap-2.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('colorHex', c)}
                  style={{ backgroundColor: c }}
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-transform',
                    form.colorHex === c ? 'ring-2 ring-offset-2 ring-text-primary scale-105' : 'hover:scale-105'
                  )}
                  aria-label={`Select color ${c}`}
                >
                  {form.colorHex === c && <span className="text-white text-xs font-bold">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border-default">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-border-default text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canWrite || isPending}
            className="flex-1 py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors"
          >
            {isPending ? 'Saving...' : isEditing ? 'Update Zone' : 'Create Zone'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────

export const GeofenceZones: React.FC = () => {
  const { toast } = useToast()
  const canWrite = usePermission(P.ORG_GEOFENCE_WRITE)
  const { data: zones = [], isLoading, error, refetch } = useGeofenceZones()
  const deleteZone = useDeleteGeofenceZone()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GeoFenceZone | null>(null)

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)
  const deptName = useMemo(() => {
    const m = new Map(departments.map((d) => [d.id, d.name]))
    return (id?: string) => (id ? m.get(id) : undefined)
  }, [departments])

  const openAdd = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (z: GeoFenceZone) => { setEditing(z); setModalOpen(true) }

  const handleDelete = async (z: GeoFenceZone) => {
    if (!window.confirm(`Deactivate "${z.name}"? This will remove it from active geofencing.`)) return
    try {
      await deleteZone.mutateAsync(z.id)
      toast('Zone deactivated', 'success')
    } catch (err) {
      toast((err as Error)?.message || 'Failed to delete zone', 'error')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary font-heading tracking-tight">Geofencing Zones</h1>
          <p className="text-text-secondary text-sm sm:text-base font-medium mt-1.5">
            Define office locations where staff can punch attendance from the mobile app.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus size={16} /> Add Zone
          </button>
        )}
      </div>

      {!canWrite && (
        <div className="flex items-center gap-2 bg-primary-light border border-primary/20 rounded-xl px-4 py-3">
          <MapPin size={16} className="text-primary" />
          <p className="text-sm font-medium text-text-secondary">
            View only — ask an admin or HR manager to add, edit, or remove zones.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : error ? (
        <EmptyState variant="error" title="Failed to load zones" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : zones.length === 0 ? (
        <EmptyState
          title="No geofencing zones yet"
          description="Add a zone to start tracking attendance locations."
          primaryAction={canWrite ? { label: 'Add Zone', onClick: openAdd } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {zones.map((z) => (
            <div key={z.id} className="bg-white border border-border-default shadow-sm rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: z.colorHex || '#0F6E56' }} />
                  <h3 className="text-base font-bold text-text-primary truncate">{z.name}</h3>
                </div>
                <Badge tone={z.active ? 'success' : 'default'}>{z.active ? 'Active' : 'Inactive'}</Badge>
              </div>

              <div className="space-y-2 text-sm text-text-secondary flex-1">
                <div className="flex items-center gap-2">
                  <Crosshair size={14} className="text-text-tertiary flex-shrink-0" />
                  <span className="truncate">{z.latitude.toFixed(5)}, {z.longitude.toFixed(5)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Radius size={14} className="text-text-tertiary flex-shrink-0" />
                  <span>{z.radiusMeters}m radius</span>
                </div>
                {z.punchMethod && (
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-text-tertiary flex-shrink-0" />
                    <span>{z.punchMethod.replace('_', ' ')}</span>
                  </div>
                )}
                {z.departmentId && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Dept</span>
                    <span>{deptName(z.departmentId) ?? 'Assigned'}</span>
                  </div>
                )}
              </div>

              {canWrite && (
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-light">
                  <button
                    onClick={() => openEdit(z)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-light rounded-lg transition-colors"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(z)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-light rounded-lg transition-colors"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ZoneFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        editing={editing}
        canWrite={canWrite}
      />
    </div>
  )
}
