import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus } from 'lucide-react'
import { useToast } from '@/shared/hooks/useToast'
import {
  useCreateCompany, useCreateBranch, useCreateDepartment, useCreateDesignation,
  type Company, type Branch, type Department, type Designation,
} from '../api/useOrg'
import {
  useCreateGeofenceZone, type GeoFenceZone,
} from '../api/useGeofence'

/**
 * Inline entity-creation modals used from the Add/Edit Employee wizard.
 *
 * Client ask: "no data should be lost… should take effect on the onboarding
 * form's dropdown immediately without reloading page." These modals render
 * through a React portal so opening/closing them does NOT unmount the parent
 * EmployeeForm — its React state (every field the admin already typed) is
 * preserved verbatim. On success we:
 *   1. let the useCreate* hook's onSuccess invalidate the relevant query key,
 *      which triggers a refetch and repopulates the dropdown option list from
 *      the server — the mutation awaits that refetch, so by the time
 *      `await mutateAsync` resolves the cache is already fresh,
 *   2. invoke onCreated(newRow) so the parent auto-selects the new value.
 *
 * NOTE — do NOT add an optimistic `qc.setQueryData([..., companyId], prev =>
 * [...prev, created])` here. The mutation hook's invalidation runs and awaits
 * the refetch BEFORE `mutateAsync` resolves; an optimistic append after the
 * await therefore duplicates the row (cache = server list [..., created],
 * then we append `created` again → shown twice in the dropdown).
 *
 * Each modal calls the same POST endpoints the Organization pages already use;
 * we deliberately reuse the useCreate* hooks in useOrg.ts / useGeofence.ts so
 * validation / cache-key semantics stay identical to those pages.
 */

// ── Shell ─────────────────────────────────────────────────────────────────────
// z-[200] sits above EmployeeForm's own z-[110] drawer so the modal is
// interactive without covering the parent's backdrop click-out.
function ModalShell({
  open, onClose, title, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return createPortal(
    <>
      <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[210] w-full max-w-md -translate-x-1/2 -translate-y-1/2 ut-card ut-card-lg"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold text-sm">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-black/5"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </>,
    document.body,
  )
}

function MField({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

function MInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props
  return (
    <input
      {...rest}
      className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none transition-colors ${
        invalid ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-border/60 focus:border-primary'
      } ${className ?? ''}`}
    />
  )
}

function MActions({
  onCancel, onSubmit, submitLabel, pending, submitDisabled,
}: {
  onCancel: () => void
  onSubmit: () => void
  submitLabel: string
  pending?: boolean
  submitDisabled?: boolean
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || submitDisabled}
        className="flex-1 py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}

// Reusable trigger — a small "+ Add" pill placed next to the field label.
// Kept here so the EmployeeForm call sites are one-liners rather than
// re-declaring the same style at each dropdown.
export function AddNewButton({ onClick, label = '+ Add new' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/15"
    >
      <Plus size={10} /> {label.replace(/^\+\s*/, '')}
    </button>
  )
}

// Small helper — clears a bag of errors when the user starts typing again.
function useLocalErrors() {
  const [errs, setErrs] = useState<Record<string, string>>({})
  const clear = (key: string) => setErrs((p) => (p[key] ? { ...p, [key]: '' } : p))
  return { errs, setErrs, clear }
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { message?: string } | null
  return (e?.message && String(e.message)) || fallback
}

// ── Department ────────────────────────────────────────────────────────────────

export function InlineCreateDepartmentModal({
  open, onClose, companyId, initialName = '', onCreated,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  initialName?: string
  onCreated: (dept: Department) => void
}) {
  const { toast } = useToast()
  const create = useCreateDepartment()
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState('')
  const { errs, setErrs, clear } = useLocalErrors()

  useEffect(() => {
    if (open) { setName(initialName); setCode(''); setErrs({}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!companyId) next.companyId = 'Select a company first, then add a department.'
    if (!name.trim()) next.name = 'Department name is required.'
    if (Object.keys(next).length) { setErrs(next); return }
    try {
      const created = await create.mutateAsync({
        companyId, name: name.trim(), code: code.trim() || undefined,
      })
      // No optimistic setQueryData here — see file-header note. The hook's
      // onSuccess invalidateQueries has already awaited the refetch by now.
      onCreated(created)
      toast('Department added', 'success')
      onClose()
    } catch (err) {
      setErrs({ submit: apiErrorMessage(err, 'Could not add department. Try again.') })
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Add Department">
      {!companyId && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pick a company on the employee form first — departments belong to a specific company.
        </div>
      )}
      <MField label="Name" required error={errs.name}>
        <MInput
          invalid={!!errs.name}
          value={name}
          onChange={(e) => { setName(e.target.value); clear('name') }}
          placeholder="e.g. Engineering"
          autoFocus
        />
      </MField>
      <MField label="Code (optional)">
        <MInput
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. ENG"
          maxLength={16}
        />
      </MField>
      {errs.submit && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.submit}
        </div>
      )}
      <MActions
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Add Department"
        pending={create.isPending}
        submitDisabled={!companyId}
      />
    </ModalShell>
  )
}

// ── Designation ───────────────────────────────────────────────────────────────

export function InlineCreateDesignationModal({
  open, onClose, companyId, departmentId, initialTitle = '', onCreated,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  departmentId?: string
  initialTitle?: string
  onCreated: (des: Designation) => void
}) {
  const { toast } = useToast()
  const create = useCreateDesignation()
  const [title, setTitle] = useState(initialTitle)
  const [grade, setGrade] = useState('')
  const { errs, setErrs, clear } = useLocalErrors()

  useEffect(() => {
    if (open) { setTitle(initialTitle); setGrade(''); setErrs({}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTitle])

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!companyId) next.companyId = 'Select a company first.'
    if (!title.trim()) next.title = 'Title is required.'
    if (Object.keys(next).length) { setErrs(next); return }
    try {
      const created = await create.mutateAsync({
        companyId,
        title: title.trim(),
        grade: grade.trim() || undefined,
        departmentId: departmentId || undefined,
      })
      // No optimistic setQueryData — the hook invalidates the whole
      // ['hrms', 'designations'] tree, which covers both the department-scoped
      // and 'all' variants, and awaits their refetch before mutateAsync
      // resolves. See file-header note for why optimistic add duplicated rows.
      onCreated(created)
      toast('Designation added', 'success')
      onClose()
    } catch (err) {
      setErrs({ submit: apiErrorMessage(err, 'Could not add designation. Try again.') })
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Add Designation">
      {!companyId && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pick a company on the employee form first.
        </div>
      )}
      <MField label="Title" required error={errs.title}>
        <MInput
          invalid={!!errs.title}
          value={title}
          onChange={(e) => { setTitle(e.target.value); clear('title') }}
          placeholder="e.g. Software Engineer"
          autoFocus
        />
      </MField>
      <MField label="Grade (optional)">
        <MInput
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          placeholder="e.g. L3"
          maxLength={16}
        />
      </MField>
      {errs.submit && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.submit}
        </div>
      )}
      <MActions
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Add Designation"
        pending={create.isPending}
        submitDisabled={!companyId}
      />
    </ModalShell>
  )
}

// ── Geofence Zone ─────────────────────────────────────────────────────────────

export function InlineCreateZoneModal({
  open, onClose, initialName = '', onCreated,
}: {
  open: boolean
  onClose: () => void
  initialName?: string
  onCreated: (zone: GeoFenceZone) => void
}) {
  const { toast } = useToast()
  const create = useCreateGeofenceZone()
  const [name, setName] = useState(initialName)
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [radius, setRadius] = useState('100')
  const [locating, setLocating] = useState(false)
  const { errs, setErrs, clear } = useLocalErrors()

  useEffect(() => {
    if (open) {
      setName(initialName); setLatitude(''); setLongitude(''); setRadius('100'); setErrs({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setErrs((p) => ({ ...p, latitude: 'Geolocation not available in this browser.' }))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6))
        setLongitude(pos.coords.longitude.toFixed(6))
        clear('latitude'); clear('longitude')
        setLocating(false)
      },
      () => {
        setErrs((p) => ({ ...p, latitude: 'Could not read location — enter it manually.' }))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Zone name is required.'
    const lat = parseFloat(latitude); const lng = parseFloat(longitude); const rad = parseFloat(radius)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) next.latitude = 'Latitude must be between -90 and 90.'
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) next.longitude = 'Longitude must be between -180 and 180.'
    if (!Number.isFinite(rad) || rad <= 0) next.radius = 'Radius must be a positive number of metres.'
    if (Object.keys(next).length) { setErrs(next); return }
    try {
      const created = await create.mutateAsync({
        name: name.trim(), latitude: lat, longitude: lng, radiusMeters: rad, active: true,
      })
      // No optimistic setQueryData — see file-header note. useCreateGeofenceZone
      // already invalidates ZONES_KEY and awaits the refetch.
      onCreated(created)
      toast('Zone added', 'success')
      onClose()
    } catch (err) {
      setErrs({ submit: apiErrorMessage(err, 'Could not add zone. Try again.') })
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Add Geofence Zone">
      <MField label="Name" required error={errs.name}>
        <MInput
          invalid={!!errs.name}
          value={name}
          onChange={(e) => { setName(e.target.value); clear('name') }}
          placeholder="e.g. HQ Building"
          autoFocus
        />
      </MField>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <MField label="Latitude" required error={errs.latitude}>
          <MInput
            invalid={!!errs.latitude}
            type="number"
            inputMode="decimal"
            step="any"
            value={latitude}
            onChange={(e) => { setLatitude(e.target.value); clear('latitude') }}
            placeholder="12.9716"
          />
        </MField>
        <MField label="Longitude" required error={errs.longitude}>
          <MInput
            invalid={!!errs.longitude}
            type="number"
            inputMode="decimal"
            step="any"
            value={longitude}
            onChange={(e) => { setLongitude(e.target.value); clear('longitude') }}
            placeholder="77.5946"
          />
        </MField>
      </div>
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
      >
        {locating ? 'Reading location…' : 'Use my current location'}
      </button>
      <MField label="Radius (metres)" required error={errs.radius}>
        <MInput
          invalid={!!errs.radius}
          type="number"
          inputMode="numeric"
          min={1}
          value={radius}
          onChange={(e) => { setRadius(e.target.value); clear('radius') }}
          placeholder="100"
        />
      </MField>
      {errs.submit && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.submit}
        </div>
      )}
      <MActions
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Add Zone"
        pending={create.isPending}
      />
    </ModalShell>
  )
}

// ── Company ───────────────────────────────────────────────────────────────────

export function InlineCreateCompanyModal({
  open, onClose, initialName = '', onCreated,
}: {
  open: boolean
  onClose: () => void
  initialName?: string
  onCreated: (company: Company) => void
}) {
  const { toast } = useToast()
  const create = useCreateCompany()
  const [name, setName] = useState(initialName)
  const [legalName, setLegalName] = useState('')
  const [industry, setIndustry] = useState('')
  const { errs, setErrs, clear } = useLocalErrors()

  useEffect(() => {
    if (open) { setName(initialName); setLegalName(''); setIndustry(''); setErrs({}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Company name is required.'
    if (Object.keys(next).length) { setErrs(next); return }
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        industry: industry.trim() || undefined,
      })
      // No optimistic setQueryData — see file-header note. useCreateCompany
      // already invalidates ['hrms', 'companies'] and awaits the refetch.
      onCreated(created)
      toast('Company added', 'success')
      onClose()
    } catch (err) {
      setErrs({ submit: apiErrorMessage(err, 'Could not add company. Try again.') })
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Add Company">
      <MField label="Name" required error={errs.name}>
        <MInput
          invalid={!!errs.name}
          value={name}
          onChange={(e) => { setName(e.target.value); clear('name') }}
          placeholder="e.g. Acme Pvt Ltd"
          autoFocus
        />
      </MField>
      <MField label="Legal Name (optional)">
        <MInput value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. Acme Private Limited" />
      </MField>
      <MField label="Industry (optional)">
        <MInput value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Technology" />
      </MField>
      {errs.submit && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.submit}
        </div>
      )}
      <MActions
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Add Company"
        pending={create.isPending}
      />
    </ModalShell>
  )
}

// ── Branch ────────────────────────────────────────────────────────────────────

export function InlineCreateBranchModal({
  open, onClose, companyId, initialName = '', onCreated,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  initialName?: string
  onCreated: (branch: Branch) => void
}) {
  const { toast } = useToast()
  const create = useCreateBranch()
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState('')
  const [city, setCity] = useState('')
  const { errs, setErrs, clear } = useLocalErrors()

  useEffect(() => {
    if (open) { setName(initialName); setCode(''); setCity(''); setErrs({}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!companyId) next.companyId = 'Select a company first.'
    if (!name.trim()) next.name = 'Branch name is required.'
    if (Object.keys(next).length) { setErrs(next); return }
    try {
      const created = await create.mutateAsync({
        companyId,
        name: name.trim(),
        code: code.trim() || undefined,
        city: city.trim() || undefined,
      })
      // No optimistic setQueryData — the hook invalidates the whole
      // ['hrms', 'branches'] tree (covers both per-company and 'all' variants)
      // and awaits the refetch. See file-header note.
      onCreated(created)
      toast('Branch added', 'success')
      onClose()
    } catch (err) {
      setErrs({ submit: apiErrorMessage(err, 'Could not add branch. Try again.') })
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Add Branch">
      {!companyId && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pick a company on the employee form first.
        </div>
      )}
      <MField label="Name" required error={errs.name}>
        <MInput
          invalid={!!errs.name}
          value={name}
          onChange={(e) => { setName(e.target.value); clear('name') }}
          placeholder="e.g. Bengaluru Office"
          autoFocus
        />
      </MField>
      <MField label="Code (optional)">
        <MInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. BLR" maxLength={16} />
      </MField>
      <MField label="City (optional)">
        <MInput value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
      </MField>
      {errs.submit && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.submit}
        </div>
      )}
      <MActions
        onCancel={onClose}
        onSubmit={submit}
        submitLabel="Add Branch"
        pending={create.isPending}
        submitDisabled={!companyId}
      />
    </ModalShell>
  )
}
