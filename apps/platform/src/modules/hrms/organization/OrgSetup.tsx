import React, { useState, useMemo } from 'react'
import { Plus, Building2, GitBranch, Layers, Award, Trash2, BarChart3, Briefcase, Clock, Pencil, Users, Laptop, Wallet, Brain } from 'lucide-react'
import { clsx } from 'clsx'
import { Can, P } from '@unifiedtree/sdk'
import { DataTable, EmptyState } from '@unifiedtree/ui-kit'
import type { Column, SortState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, HrTabs, HrTabPanel, HrDrawer, HrSelect } from '@/shared/components/hr'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useToast } from '@/shared/hooks/useToast'
import {
  useCompanies, useCreateCompany, useUpdateCompany, useArchiveCompany,
  useBranches, useCreateBranch, useArchiveBranch,
  useDepartments, useCreateDepartment, useArchiveDepartment, useSetDepartmentHead,
  useDesignations, useCreateDesignation, useUpdateDesignation, useArchiveDesignation,
  useGrades, useCreateGrade, useUpdateGrade, useDeleteGrade,
  useEmploymentTypes, useCreateEmploymentType, useUpdateEmploymentType, useDeleteEmploymentType,
  type Company, type Designation, type Grade, type EmploymentTypeRecord,
} from '../api/useOrg'
// Shifts on this page edit attendance.shift_policies — the ONLY shift table the
// late-mark calculation reads (AttendanceService.getShiftProfile ~line 666 and
// the shiftStart.plusMinutes(grace) cutoff ~lines 1234-1235). This tab used to
// write org.shifts via useOrg's useShifts, which nothing in attendance reads:
// HR would move a shift to 10:00 here, the app would keep marking people late
// at 09:15, and the edit looked like it had worked. See useShiftPolicies.ts.
import {
  useShiftPolicies, useCreateShiftPolicy, useUpdateShiftPolicy, useDeleteShiftPolicy,
  type ShiftPolicy, type ShiftPolicyPayload, type ShiftType,
} from '../api/useShiftPolicies'
import { useEmployeeDirectory } from '../api/useWorkforce'
import { useHrConfig, useUpdateHrConfig } from '../api/useSettings'

type Tab = 'companies' | 'branches' | 'departments' | 'designations' | 'grades' | 'employment-types' | 'shifts'

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'companies',        label: 'Companies',        icon: Building2 },
  { key: 'branches',         label: 'Branches',         icon: GitBranch },
  { key: 'departments',      label: 'Departments',      icon: Layers },
  { key: 'designations',     label: 'Designations',     icon: Award },
  { key: 'grades',           label: 'Grades',           icon: BarChart3 },
  { key: 'employment-types', label: 'Emp. Types',       icon: Briefcase },
  { key: 'shifts',           label: 'Shifts',           icon: Clock },
]

// Day-bitmask helpers (DayChips / DayToggle) lived here to edit org.shifts
// `days_bitmask`. attendance.shift_policies has no per-shift working-days
// column, so the control had nowhere to write once this tab was repointed —
// it was removed rather than left rendering a value the backend discards.
// Per-employee weekly offs are still set on the employee record.

// ── Department presets (mirror mobile) ───────────────────────────────────────
// Backend may not persist these; we store per-device in localStorage so the
// list keeps its colour dots / icons after reload. Keyed by department id.

const DEPT_COLORS = ['#0F6E56', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#22C55E', '#EF4444', '#0EA5E9'] as const
const DEFAULT_DEPT_COLOR: string = DEPT_COLORS[0]
const DEPT_ICONS = [
  { key: 'team',    label: 'Team',    Icon: Users },
  { key: 'laptop',  label: 'Laptop',  Icon: Laptop },
  { key: 'finance', label: 'Finance', Icon: Wallet },
  { key: 'brain',   label: 'Brain',   Icon: Brain },
] as const
const DEFAULT_DEPT_ICON = 'team'

function readDeptColor(id: string): string {
  if (typeof window === 'undefined') return DEFAULT_DEPT_COLOR
  try { return window.localStorage.getItem(`dept_color_${id}`) || DEFAULT_DEPT_COLOR } catch { return DEFAULT_DEPT_COLOR }
}
function writeDeptColor(id: string, hex: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(`dept_color_${id}`, hex) } catch { /* quota / disabled — ignore */ }
}
function writeDeptIcon(id: string, key: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(`dept_icon_${id}`, key) } catch { /* ignore */ }
}

// ── Shift type ───────────────────────────────────────────────────────────────
// ShiftType is imported from useShiftPolicies so this picker can never drift
// from the ShiftType enum the backend actually persists.
const SHIFT_TYPES: { value: ShiftType; label: string }[] = [
  { value: 'FIXED',      label: 'Fixed' },
  { value: 'FLEXIBLE',   label: 'Flexible' },
  { value: 'ROTATIONAL', label: 'Rotational' },
  { value: 'NIGHT',      label: 'Night' },
]

// Server-side bounds from ShiftDtos.ShiftPolicyRequest — mirrored so the admin
// gets an inline message instead of a 400 out of bean validation.
const GRACE_MIN = 0
const GRACE_MAX = 120
const HOURS_MIN = 0.5
const HOURS_MAX = 24
const OT_MIN = 1
const OT_MAX = 9.99

// Parse HH:MM into minutes-of-day. Returns null on malformed input so the
// caller can skip the wrap check rather than blocking on garbage.
function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** "09:00:00" → "09:00" for <input type="time">; tolerant of null/short values. */
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

// ── Shared form primitives ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="ut-input" />
}

function SlideModal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  if (!open) return null
  return <HrDrawer title={title} onClose={onClose}>{children}</HrDrawer>
}

const BTN_PRIMARY = 'px-4 py-2.5 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors'
const BTN_CANCEL  = 'px-4 py-2.5 border border-border-default text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors'
const BTN_ADD     = 'flex items-center gap-2 px-4 py-2 bg-[#059669] hover:bg-[#047857] disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors'
const BTN_ICON    = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
const BTN_DEL     = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]'

// ── Companies Tab ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: companies = [], isLoading, error, refetch } = useCompanies()
  const createCompany = useCreateCompany()
  const updateCompany = useUpdateCompany()
  const archiveCompany = useArchiveCompany()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Company | null>(null)
  const emptyForm = { name: '', legalName: '', industry: '', currency: 'INR', country: 'India' }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (co: Company) => {
    setEditing(co)
    setForm({
      name: co.name, legalName: co.legalName ?? '', industry: co.industry ?? '',
      currency: co.currency ?? 'INR', country: co.country ?? 'India',
    })
    setOpen(true)
  }
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    try {
      if (editing) {
        await updateCompany.mutateAsync({ id: editing.id, ...form })
        toast('Company updated', 'success')
      } else {
        await createCompany.mutateAsync(form)
        toast('Company created', 'success')
      }
      setOpen(false)
    } catch { toast(editing ? 'Failed to update company' : 'Failed to create company', 'error') }
  }

  const handleArchive = async (co: Company) => {
    const ok = await confirm({
      title: `Archive ${co.name}?`,
      body: 'Employees and history stay intact, but this company will be hidden from lists and pickers.',
      confirmLabel: 'Archive',
      tone: 'danger',
    })
    if (!ok) return
    try { await archiveCompany.mutateAsync(co.id); toast('Company archived', 'success') }
    catch { toast('Failed to archive company', 'error') }
  }

  const isPending = createCompany.isPending || updateCompany.isPending

  const cols: Column<Company>[] = [
    {
      key: 'name', header: 'Company',
      cell: (co) => (
        <div>
          <p className="font-semibold text-text-primary text-sm">{co.name}</p>
          {co.legalName && <p className="text-xs text-text-tertiary">{co.legalName}</p>}
        </div>
      ),
    },
    {
      key: 'industry', header: 'Industry', hideBelow: 'md',
      cell: (co) => <span className="text-sm text-text-secondary">{[co.industry, co.country].filter(Boolean).join(' · ') || '—'}</span>,
    },
    {
      key: 'employees', header: 'Employees', hideBelow: 'lg',
      cell: (co) => <span className="text-sm tabular-nums text-text-secondary">{co.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (co) => <HrStatusPill tone={co.active ? 'ok' : 'gray'}>{co.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (co) => (
        <Can code={P.ORG_COMPANY_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(co)} aria-label={`Edit ${co.name}`} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleArchive(co)} aria-label={`Archive company ${co.name}`} className={BTN_DEL}><Trash2 size={13} /></button>
          </div>
        </Can>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.ORG_COMPANY_WRITE}>
          <button onClick={openAdd} className={BTN_ADD}><Plus size={15} /> Add Company</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={companies} getRowKey={(c) => c.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No companies yet"
          emptyDescription="Add your first company to get started." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Company' : 'Add Company'}>
        <div className="space-y-4">
          <Field label="Company Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme Pvt Ltd" /></Field>
          <Field label="Legal Name"><Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Registered legal name" /></Field>
          <Field label="Industry"><Input value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Technology" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Currency"><Input value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
            <Field label="Country"><Input value={form.country} onChange={(e) => set('country', e.target.value)} /></Field>
          </div>

          {editing ? <EmployeeCodeFormatSection companyId={editing.id} /> : null}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.ORG_COMPANY_WRITE}>
              <button onClick={handleSave} disabled={isPending} className={BTN_PRIMARY}>
                {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </Can>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Employee ID auto-increment format ─────────────────────────────────────
// Two-input editor rendered inside Edit Company modal. Save is its own button
// (separate from the Company Save) because it hits /v1/settings/hr-configuration
// while the company fields hit /v1/companies. Live preview shows the next ID
// that will be issued.
function EmployeeCodeFormatSection({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const { data: cfg, isLoading } = useHrConfig(companyId)
  const updateCfg = useUpdateHrConfig()
  const [prefix, setPrefix] = React.useState('')
  const [startNumberRaw, setStartNumberRaw] = React.useState('')
  const [dirty, setDirty] = React.useState(false)

  // Populate from server when it loads (only if the user hasn't started editing).
  React.useEffect(() => {
    if (cfg && !dirty) {
      setPrefix(cfg.employeeCodePrefix ?? 'EMP')
      // Represent the "starting number" as the exact user-visible string —
      // padding is inferred from its length. So '001' → padding 3, '1001' → 4.
      const pad = cfg.employeeCodePadding ?? 4
      setStartNumberRaw(String(cfg.employeeCodeNextNumber ?? 1).padStart(pad, '0'))
    }
  }, [cfg, dirty])

  const prefixOk = /^[A-Za-z0-9]{1,10}$/.test(prefix)
  const numberOk = /^\d{1,8}$/.test(startNumberRaw) && Number(startNumberRaw) >= 1
  const canSave  = prefixOk && numberOk && !updateCfg.isPending

  const previewCode = prefixOk && numberOk
    ? `${prefix.toUpperCase()}-${startNumberRaw}`
    : '—'

  const onSave = async () => {
    try {
      await updateCfg.mutateAsync({
        companyId,
        body: {
          employeeCodePrefix: prefix.toUpperCase(),
          employeeCodeNextNumber: Number(startNumberRaw),
          employeeCodePadding: startNumberRaw.length,
        },
      })
      toast('Employee ID format saved', 'success')
      setDirty(false)
    } catch {
      toast('Failed to save employee ID format', 'error')
    }
  }

  if (isLoading) {
    return (
      <div className="border-t border-border-default pt-4 mt-2">
        <div className="text-xs text-text-tertiary">Loading employee ID format...</div>
      </div>
    )
  }

  return (
    <div className="border-t border-border-default pt-4 mt-2 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-text-primary">Employee ID auto-generation</h4>
        <p className="text-xs text-text-secondary mt-0.5">
          New employees get an auto-generated ID. Changes only affect employees created after saving.
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <Field label="Prefix">
          <Input
            value={prefix}
            onChange={(e) => { setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)); setDirty(true) }}
            placeholder="UNI"
            maxLength={10}
          />
        </Field>
        <div className="pb-2 text-lg font-bold text-text-tertiary">-</div>
        <Field label="Starting number">
          <Input
            value={startNumberRaw}
            onChange={(e) => { setStartNumberRaw(e.target.value.replace(/\D/g, '').slice(0, 8)); setDirty(true) }}
            placeholder="0001"
            maxLength={8}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between bg-bg-surface rounded-lg px-3 py-2">
        <span className="text-xs text-text-secondary">Next employee will be:</span>
        <span className="font-mono text-sm font-bold text-primary">{previewCode}</span>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onSave}
          disabled={!canSave || !dirty}
          className={BTN_PRIMARY + ' disabled:opacity-50 disabled:cursor-not-allowed'}
        >
          {updateCfg.isPending ? 'Saving...' : 'Save Format'}
        </button>
      </div>
      {!prefixOk && prefix.length > 0 && (
        <p className="text-xs text-red-600">Prefix must be 1-10 letters or digits (no spaces or dashes).</p>
      )}
      {!numberOk && startNumberRaw.length > 0 && (
        <p className="text-xs text-red-600">Starting number must be 1-8 digits.</p>
      )}
    </div>
  )
}

// ── Branches Tab ──────────────────────────────────────────────────────────────

interface CompanyProp { activeCompany?: Company }

function BranchesTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: branches = [], isLoading, error, refetch } = useBranches(activeCompany?.id)
  const createBranch = useCreateBranch()
  const archiveBranch = useArchiveBranch()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', city: '', state: '', country: 'India', isHeadquarters: false })
  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  const handleCreate = async () => {
    if (!activeCompany || !form.name.trim()) return
    try {
      await createBranch.mutateAsync({ companyId: activeCompany.id, ...form })
      toast('Branch created', 'success')
      setOpen(false)
      setForm({ name: '', code: '', city: '', state: '', country: 'India', isHeadquarters: false })
    } catch { toast('Failed to create branch', 'error') }
  }

  const handleArchive = async (br: { id: string; name: string }) => {
    const ok = await confirm({
      title: `Archive branch ${br.name}?`,
      body: 'The branch will be hidden from lists and pickers. Existing assignments are preserved.',
      confirmLabel: 'Archive',
      tone: 'danger',
    })
    if (!ok) return
    try { await archiveBranch.mutateAsync(br.id); toast('Branch archived', 'success') }
    catch { toast('Failed to archive branch', 'error') }
  }

  type Br = typeof branches[number]
  const cols: Column<Br>[] = [
    {
      key: 'name', header: 'Branch',
      cell: (br) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary text-sm">{br.name}</span>
          {br.headquarters && <HrStatusPill tone="warn">HQ</HrStatusPill>}
        </div>
      ),
    },
    {
      key: 'location', header: 'Location', hideBelow: 'md',
      cell: (br) => <span className="text-sm text-text-secondary">{[br.city, br.state, br.country].filter(Boolean).join(', ') || '—'}</span>,
    },
    {
      key: 'employees', header: 'Employees', hideBelow: 'lg',
      cell: (br) => <span className="text-sm tabular-nums text-text-secondary">{br.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (br) => <HrStatusPill tone={br.active ? 'ok' : 'gray'}>{br.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (br) => (
        <Can code={P.ORG_COMPANY_WRITE}>
          <button onClick={() => handleArchive(br)} aria-label={`Archive branch ${br.name}`} className={BTN_DEL}><Trash2 size={14} /></button>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its branches." />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.ORG_COMPANY_WRITE}>
          <button onClick={() => setOpen(true)} className={BTN_ADD}><Plus size={15} /> Add Branch</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={branches} getRowKey={(b) => b.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No branches yet"
          emptyDescription="Add a branch to map your office locations." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title="Add Branch">
        <div className="space-y-4">
          <Field label="Branch Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Mumbai Office" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. MUM" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Mumbai" /></Field>
            <Field label="State"><Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="Maharashtra" /></Field>
          </div>
          <Field label="Country"><Input value={form.country} onChange={(e) => set('country', e.target.value)} /></Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isHeadquarters}
              onChange={(e) => set('isHeadquarters', e.target.checked)}
              className="accent-primary w-4 h-4" />
            <span className="text-sm text-text-secondary">Mark as Headquarters</span>
          </label>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <button onClick={handleCreate} disabled={createBranch.isPending} className={BTN_PRIMARY}>
              {createBranch.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Departments Tab ───────────────────────────────────────────────────────────

function DepartmentsTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: departments = [], isLoading, error, refetch } = useDepartments(activeCompany?.id ?? '')
  const { data: empPage } = useEmployeeDirectory({ companyId: activeCompany?.id, pageSize: 200 })
  const employees = empPage?.content ?? []
  const createDept = useCreateDepartment()
  const archiveDept = useArchiveDepartment()
  const setHead = useSetDepartmentHead()
  const [open, setOpen] = useState(false)
  const emptyDeptForm = { name: '', code: '', description: '', departmentHeadEmployeeId: '', colorHex: DEFAULT_DEPT_COLOR, iconKey: DEFAULT_DEPT_ICON }
  const [form, setForm] = useState(emptyDeptForm)
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const empLabel = (id?: string) => {
    const e = employees.find((x) => x.id === id)
    return e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : ''
  }

  const handleCreate = async () => {
    if (!activeCompany) return
    const trimmed = form.name.trim()
    if (!trimmed) return

    // Pre-submit duplicate-name check (case-insensitive) against the loaded list.
    // Cheap client-side guard — server remains the source of truth for anything
    // that landed after the last refetch.
    const norm = trimmed.toLowerCase()
    if (departments.some((d) => d.name.trim().toLowerCase() === norm)) {
      toast('A department with this name already exists', 'error')
      return
    }

    try {
      const created = await createDept.mutateAsync({
        companyId: activeCompany.id,
        name: trimmed,
        code: form.code || undefined,
        description: form.description || undefined,
        departmentHeadEmployeeId: form.departmentHeadEmployeeId || undefined,
      })
      // Persist device-local preset choices keyed by the new dept id.
      if (created?.id) {
        writeDeptColor(created.id, form.colorHex)
        writeDeptIcon(created.id, form.iconKey)
      }
      toast('Department created', 'success')
      setOpen(false)
      setForm(emptyDeptForm)
    } catch (err) {
      // 201-lost recovery: on network hiccup the POST may have landed but the
      // response was dropped. Refetch and, if a dept with this name now exists,
      // treat as success. Otherwise surface the real failure.
      const isNetwork = err instanceof TypeError || (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message))
      if (isNetwork) {
        try {
          const refreshed = await refetch()
          const list = refreshed.data ?? []
          const match = list.find((d) => d.name.trim().toLowerCase() === norm)
          if (match) {
            writeDeptColor(match.id, form.colorHex)
            writeDeptIcon(match.id, form.iconKey)
            toast('Department created', 'success')
            setOpen(false)
            setForm(emptyDeptForm)
            return
          }
        } catch { /* fall through to error toast */ }
      }
      toast('Failed to create department', 'error')
    }
  }

  const handleArchive = async (dept: { id: string; name: string }) => {
    const ok = await confirm({
      title: `Archive department ${dept.name}?`,
      body: 'The department will be hidden from lists and pickers. Existing employee assignments are preserved.',
      confirmLabel: 'Archive',
      tone: 'danger',
    })
    if (!ok) return
    try { await archiveDept.mutateAsync(dept.id); toast('Department archived', 'success') }
    catch { toast('Failed to archive department', 'error') }
  }

  const handleSetHead = async (id: string, employeeId: string) => {
    try {
      await setHead.mutateAsync({ id, employeeId: employeeId || undefined })
      toast('Department head updated', 'success')
    } catch { toast('Failed to update department head', 'error') }
  }

  type Dept = typeof departments[number]
  const cols: Column<Dept>[] = [
    {
      key: 'name', header: 'Department',
      cell: (d) => (
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: readDeptColor(d.id) }}
            aria-hidden
          />
          <span className="font-semibold text-text-primary text-sm">{d.name}</span>
        </div>
      ),
    },
    {
      key: 'code', header: 'Code', hideBelow: 'md',
      cell: (d) => <span className="text-sm text-text-secondary">{d.code || '—'}</span>,
    },
    {
      key: 'head', header: 'Head', hideBelow: 'md',
      cell: (d) => (
        <Can code={P.HRMS_DEPARTMENT_WRITE} fallback={<span className="text-sm text-text-secondary">{empLabel(d.departmentHeadEmployeeId) || '—'}</span>}>
          <select value={d.departmentHeadEmployeeId ?? ''} onChange={(e) => handleSetHead(d.id, e.target.value)}
            className="ut-select ut-select-sm w-auto max-w-[10rem]">
            <option value="">None</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{[emp.firstName, emp.lastName].filter(Boolean).join(' ')}</option>
            ))}
          </select>
        </Can>
      ),
    },
    {
      key: 'employees', header: 'Employees', hideBelow: 'lg',
      cell: (d) => <span className="text-sm tabular-nums text-text-secondary">{d.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (d) => <HrStatusPill tone={d.active ? 'ok' : 'gray'}>{d.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (d) => (
        <Can code={P.HRMS_DEPARTMENT_WRITE}>
          <button onClick={() => handleArchive(d)} aria-label={`Archive department ${d.name}`} className={BTN_DEL}><Trash2 size={14} /></button>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its departments." />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.HRMS_DEPARTMENT_WRITE}>
          <button onClick={() => setOpen(true)} className={BTN_ADD}><Plus size={15} /> Add Department</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={departments} getRowKey={(d) => d.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No departments yet"
          emptyDescription="Structure your company by adding departments." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title="Add Department">
        <div className="space-y-4">
          <Field label="Department Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Engineering" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. ENG" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>
          <Field label="Department Head">
            <HrSelect
              value={form.departmentHeadEmployeeId}
              onChange={(v) => set('departmentHeadEmployeeId', v)}
              options={[
                { value: '', label: 'None' },
                ...employees.map((emp) => ({ value: emp.id, label: [emp.firstName, emp.lastName].filter(Boolean).join(' ') })),
              ]}
            />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {DEPT_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => set('colorHex', hex)}
                  aria-label={`Colour ${hex}`}
                  aria-pressed={form.colorHex === hex}
                  className={clsx(
                    'w-7 h-7 rounded-full transition-transform',
                    form.colorHex === hex ? 'ring-2 ring-offset-2 ring-[#059669] scale-110' : 'hover:scale-105'
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </Field>
          <Field label="Icon">
            <div className="flex flex-wrap gap-2">
              {DEPT_ICONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set('iconKey', key)}
                  aria-label={label}
                  aria-pressed={form.iconKey === key}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                    form.iconKey === key
                      ? 'border-[#059669] bg-[#059669]/10 text-[#059669]'
                      : 'border-border-default bg-bg-surface text-text-secondary hover:text-text-primary'
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <button onClick={handleCreate} disabled={createDept.isPending} className={BTN_PRIMARY}>
              {createDept.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Designations Tab ──────────────────────────────────────────────────────────

function DesignationsTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: designations = [], isLoading, error, refetch } = useDesignations(activeCompany?.id ?? '')
  const createDesig = useCreateDesignation()
  const updateDesig = useUpdateDesignation()
  const archiveDesig = useArchiveDesignation()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Designation | null>(null)
  const emptyForm = { title: '', grade: '' }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (d: Designation) => {
    setEditing(d)
    setForm({ title: d.title, grade: d.grade ?? '' })
    setOpen(true)
  }
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!activeCompany || !form.title.trim()) return
    try {
      if (editing) {
        await updateDesig.mutateAsync({ id: editing.id, ...form })
        toast('Designation updated', 'success')
      } else {
        await createDesig.mutateAsync({ companyId: activeCompany.id, ...form })
        toast('Designation created', 'success')
      }
      setOpen(false)
    } catch { toast(editing ? 'Failed to update designation' : 'Failed to create designation', 'error') }
  }

  const handleArchive = async (d: Designation) => {
    const ok = await confirm({
      title: `Archive designation ${d.title}?`,
      body: 'The designation will be hidden from lists and pickers. Existing employee assignments are preserved.',
      confirmLabel: 'Archive',
      tone: 'danger',
    })
    if (!ok) return
    try { await archiveDesig.mutateAsync(d.id); toast('Designation archived', 'success') }
    catch { toast('Failed to archive designation', 'error') }
  }

  const isPending = createDesig.isPending || updateDesig.isPending

  type Desig = typeof designations[number]
  const cols: Column<Desig>[] = [
    {
      key: 'title', header: 'Title',
      cell: (d) => <span className="font-semibold text-text-primary text-sm">{d.title}</span>,
    },
    {
      key: 'grade', header: 'Grade', hideBelow: 'md',
      cell: (d) => <span className="text-sm text-text-secondary">{d.grade || '—'}</span>,
    },
    {
      key: 'headcount', header: 'Headcount', hideBelow: 'lg',
      cell: (d) => <span className="text-sm tabular-nums text-text-secondary">{d.headcount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (d) => <HrStatusPill tone={d.active ? 'ok' : 'gray'}>{d.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (d) => (
        <Can code={P.HRMS_DESIGNATION_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(d)} aria-label={`Edit ${d.title}`} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleArchive(d)} aria-label={`Archive designation ${d.title}`} className={BTN_DEL}><Trash2 size={13} /></button>
          </div>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its designations." />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.HRMS_DESIGNATION_WRITE}>
          <button onClick={openAdd} className={BTN_ADD}><Plus size={15} /> Add Designation</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={designations} getRowKey={(d) => d.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No designations yet"
          emptyDescription="Define roles and job titles for your employees." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Designation' : 'Add Designation'}>
        <div className="space-y-4">
          <Field label="Title *"><Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Senior Engineer" /></Field>
          <Field label="Grade"><Input value={form.grade} onChange={(e) => set('grade', e.target.value)} placeholder="e.g. L4" /></Field>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.HRMS_DESIGNATION_WRITE}>
              <button onClick={handleSave} disabled={isPending} className={BTN_PRIMARY}>
                {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </Can>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Grades Tab ────────────────────────────────────────────────────────────────

function GradesTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: grades = [], isLoading, error, refetch } = useGrades(activeCompany?.id ?? '')
  const createGrade = useCreateGrade()
  const updateGrade = useUpdateGrade()
  const deleteGrade = useDeleteGrade()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Grade | null>(null)
  const emptyForm = { name: '', code: '', level: '0', description: '' }
  const [form, setForm] = useState(emptyForm)
  const [sort, setSort] = useState<SortState>({ key: 'level', direction: 'asc' })

  const sorted = useMemo(() => {
    const copy = [...grades]
    if (sort.key === 'level') copy.sort((a, b) => sort.direction === 'asc' ? a.level - b.level : b.level - a.level)
    return copy
  }, [grades, sort])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (g: Grade) => {
    setEditing(g)
    setForm({ name: g.name, code: g.code ?? '', level: String(g.level), description: g.description ?? '' })
    setOpen(true)
  }
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!activeCompany || !form.name.trim()) return
    try {
      const payload = {
        companyId: activeCompany.id,
        name: form.name,
        code: form.code || undefined,
        level: Number(form.level) || 0,
        description: form.description || undefined,
      }
      if (editing) {
        await updateGrade.mutateAsync({ id: editing.id, ...payload })
        toast('Grade updated', 'success')
      } else {
        await createGrade.mutateAsync(payload)
        toast('Grade created', 'success')
      }
      setOpen(false)
    } catch { toast('Failed to save grade', 'error') }
  }

  const handleDelete = async (g: Grade) => {
    if (!activeCompany) return
    const ok = await confirm({
      title: `Delete grade ${g.name}?`,
      body: 'This cannot be undone. Employees on this grade will need to be reassigned.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try { await deleteGrade.mutateAsync({ id: g.id, companyId: activeCompany.id }); toast('Grade deleted', 'success') }
    catch { toast('Failed to delete grade', 'error') }
  }

  const isPending = createGrade.isPending || updateGrade.isPending

  const cols: Column<Grade>[] = [
    {
      key: 'level', header: 'Level', sortable: true,
      cell: (g) => <span className="text-sm text-text-secondary tabular-nums">{g.level}</span>,
    },
    {
      key: 'name', header: 'Name',
      cell: (g) => (
        <div>
          <p className="font-semibold text-text-primary text-sm">{g.name}</p>
          {g.description && <p className="text-xs text-text-tertiary">{g.description}</p>}
        </div>
      ),
    },
    {
      key: 'code', header: 'Code', hideBelow: 'md',
      cell: (g) => <span className="text-sm text-text-secondary">{g.code || '—'}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (g) => <HrStatusPill tone={g.active ? 'ok' : 'gray'}>{g.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (g) => (
        <Can code={P.HRMS_GRADE_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(g)} aria-label={`Edit grade ${g.name}`} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(g)} aria-label={`Delete grade ${g.name}`} className={BTN_DEL}><Trash2 size={13} /></button>
          </div>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its pay grades." />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.HRMS_GRADE_WRITE}>
          <button onClick={openAdd} className={BTN_ADD}><Plus size={15} /> Add Grade</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={sorted} getRowKey={(g) => g.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} sortState={sort} onSortChange={setSort}
          emptyTitle="No grades configured"
          emptyDescription="Create pay grades to structure your compensation bands." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Grade' : 'Add Grade'}>
        <div className="space-y-4">
          <Field label="Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Senior" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. L4" /></Field>
          <Field label="Level">
            <Input type="number" min="0" value={form.level}
              onChange={(e) => set('level', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.HRMS_GRADE_WRITE}>
              <button onClick={handleSave} disabled={isPending} className={BTN_PRIMARY}>
                {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </Can>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Employment Types Tab ──────────────────────────────────────────────────────

function EmploymentTypesTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const { data: types = [], isLoading, error, refetch } = useEmploymentTypes(activeCompany?.id ?? '')
  const createType = useCreateEmploymentType()
  const updateType = useUpdateEmploymentType()
  const deleteType = useDeleteEmploymentType()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EmploymentTypeRecord | null>(null)
  const emptyForm = { name: '', code: '', payrollEligible: true }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (t: EmploymentTypeRecord) => {
    setEditing(t)
    setForm({ name: t.name, code: t.code ?? '', payrollEligible: t.payrollEligible })
    setOpen(true)
  }
  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!activeCompany || !form.name.trim()) return
    try {
      const payload = {
        companyId: activeCompany.id,
        name: form.name,
        code: form.code || undefined,
        payrollEligible: form.payrollEligible,
      }
      if (editing) {
        await updateType.mutateAsync({ id: editing.id, ...payload })
        toast('Employment type updated', 'success')
      } else {
        await createType.mutateAsync(payload)
        toast('Employment type created', 'success')
      }
      setOpen(false)
    } catch { toast('Failed to save employment type', 'error') }
  }

  const handleDelete = async (t: EmploymentTypeRecord) => {
    if (!activeCompany) return
    const ok = await confirm({
      title: `Delete employment type ${t.name}?`,
      body: 'This cannot be undone. Employees on this type will need to be reassigned.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try { await deleteType.mutateAsync({ id: t.id, companyId: activeCompany.id }); toast('Employment type deleted', 'success') }
    catch { toast('Failed to delete employment type', 'error') }
  }

  const isPending = createType.isPending || updateType.isPending

  const cols: Column<EmploymentTypeRecord>[] = [
    {
      key: 'name', header: 'Name',
      cell: (t) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary text-sm">{t.name}</span>
          {t.system && <HrStatusPill tone="purple">System</HrStatusPill>}
        </div>
      ),
    },
    {
      key: 'code', header: 'Code', hideBelow: 'md',
      cell: (t) => <span className="text-sm text-text-secondary">{t.code || '—'}</span>,
    },
    {
      key: 'payroll', header: 'Payroll Eligible', hideBelow: 'lg',
      cell: (t) => <HrStatusPill tone={t.payrollEligible ? 'ok' : 'gray'}>{t.payrollEligible ? 'Yes' : 'No'}</HrStatusPill>,
    },
    {
      key: 'status', header: 'Status',
      cell: (t) => <HrStatusPill tone={t.active ? 'ok' : 'gray'}>{t.active ? 'Active' : 'Inactive'}</HrStatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (t) => t.system ? null : (
        <Can code={P.HRMS_EMPLOYMENT_TYPE_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(t)} aria-label={`Edit employment type ${t.name}`} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(t)} aria-label={`Delete employment type ${t.name}`} className={BTN_DEL}><Trash2 size={13} /></button>
          </div>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its employment types." />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can code={P.HRMS_EMPLOYMENT_TYPE_WRITE}>
          <button onClick={openAdd} className={BTN_ADD}><Plus size={15} /> Add Type</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={types} getRowKey={(t) => t.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No employment types"
          emptyDescription="System types are seeded automatically. Add custom types here." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Employment Type' : 'Add Employment Type'}>
        <div className="space-y-4">
          <Field label="Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Part Time" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. PART_TIME" /></Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.payrollEligible}
              onChange={(e) => set('payrollEligible', e.target.checked)}
              className="accent-primary w-4 h-4" />
            <span className="text-sm text-text-secondary">Payroll eligible</span>
          </label>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.HRMS_EMPLOYMENT_TYPE_WRITE}>
              <button onClick={handleSave} disabled={isPending} className={BTN_PRIMARY}>
                {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </Can>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Shifts Tab ────────────────────────────────────────────────────────────────
//
// Edits attendance.shift_policies through /v1/shifts (useShiftPolicies) — the
// same rows the mobile app's Shift Timings screen writes, so an edit made here
// is visible there and, crucially, actually moves the late cutoff.
//
// Writes require `attendance.regularization.approve` (ShiftController's
// @PreAuthorize), NOT the `hrms.shift.write` that gated the old org.shifts
// endpoint: gating on the retired code would show Save to people the API 403s
// and hide it from the HR admins who can actually use it.

function ShiftsTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const companyId = activeCompany?.id ?? ''
  const { data: shifts = [], isLoading, error, refetch } = useShiftPolicies(companyId)
  const createShift = useCreateShiftPolicy()
  const updateShift = useUpdateShiftPolicy()
  const deleteShift = useDeleteShiftPolicy()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftPolicy | null>(null)
  const emptyForm = {
    name: '',
    startTime: '09:00',
    endTime: '18:00',
    // 15 mirrors the attendance.shift_policies.grace_period_minutes default
    // (org.shifts defaulted to 10 — that mismatch is part of what made the two
    // screens disagree about who was late).
    gracePeriodMinutes: '15',
    workingHoursPerDay: '8',
    overtimeApplicable: false,
    overtimeMultiplier: '1.5',
    shiftType: 'FIXED' as ShiftType,
  }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (s: ShiftPolicy) => {
    setEditing(s)
    setForm({
      name: s.name ?? '',
      // Times arrive as "HH:mm:ss"; <input type="time"> wants "HH:mm".
      startTime: hhmm(s.startTime) || '09:00',
      endTime: hhmm(s.endTime) || '18:00',
      gracePeriodMinutes: String(s.gracePeriodMinutes ?? 15),
      workingHoursPerDay: s.workingHoursPerDay != null ? String(s.workingHoursPerDay) : '8',
      overtimeApplicable: !!s.overtimeApplicable,
      overtimeMultiplier: s.overtimeMultiplier != null ? String(Number(s.overtimeMultiplier)) : '1.5',
      // shiftType round-trips on this endpoint, so it no longer has to be
      // inferred from a nightShift boolean the way the org.shifts version did.
      shiftType: s.shiftType ?? 'FIXED',
    })
    setOpen(true)
  }
  const set = (k: string, v: string | number | boolean) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!companyId) return
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      toast('Shift name is required', 'error')
      return
    }
    // Mirrors EmployeeShiftService.validateShiftWindow: a zero-length window is
    // always rejected (the late-mark math divides by it), and only NIGHT may
    // wrap past midnight (22:00 → 06:00).
    const startMin = parseHHMM(form.startTime)
    const endMin   = parseHHMM(form.endTime)
    if (startMin !== null && endMin !== null && startMin === endMin) {
      toast('Shift start and end time must differ', 'error')
      return
    }
    if (form.shiftType === 'FIXED' && startMin !== null && endMin !== null && endMin < startMin) {
      toast('A fixed shift must end after it starts (use Night to wrap past midnight)', 'error')
      return
    }
    const grace = Number(form.gracePeriodMinutes)
    if (!Number.isFinite(grace) || grace < GRACE_MIN || grace > GRACE_MAX) {
      toast(`Grace period must be between ${GRACE_MIN} and ${GRACE_MAX} minutes`, 'error')
      return
    }
    const hours = Number(form.workingHoursPerDay)
    if (!Number.isFinite(hours) || hours < HOURS_MIN || hours > HOURS_MAX) {
      toast(`Working hours per day must be between ${HOURS_MIN} and ${HOURS_MAX}`, 'error')
      return
    }
    const multiplier = Number(form.overtimeMultiplier)
    if (form.overtimeApplicable && (!Number.isFinite(multiplier) || multiplier < OT_MIN || multiplier > OT_MAX)) {
      toast(`Overtime rate must be between ${OT_MIN.toFixed(1)} and ${OT_MAX}`, 'error')
      return
    }

    const payload: ShiftPolicyPayload = {
      name: trimmedName,
      shiftType: form.shiftType,
      // Jackson accepts "HH:mm", but send seconds so what we PUT matches the
      // "HH:mm:ss" the API hands back.
      startTime: `${form.startTime}:00`,
      endTime: `${form.endTime}:00`,
      gracePeriodMinutes: grace,
      workingHoursPerDay: hours,
      overtimeApplicable: form.overtimeApplicable,
      // Only send a multiplier when OT is on — the server bound is 1.0..9.99 and
      // rejects anything below 1.0, so an OT-off shift must omit it entirely.
      ...(form.overtimeApplicable ? { overtimeMultiplier: multiplier } : {}),
    }
    try {
      if (editing) {
        await updateShift.mutateAsync({ id: editing.id, companyId, data: payload })
        toast('Shift updated', 'success')
      } else {
        await createShift.mutateAsync({ companyId, data: payload })
        toast('Shift created', 'success')
      }
      setOpen(false)
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save shift', 'error')
    }
  }

  const handleDelete = async (s: ShiftPolicy) => {
    if (!companyId) return
    const ok = await confirm({
      title: `Delete shift ${s.name}?`,
      body: 'Employees still assigned to this shift must be moved to another one first.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteShift.mutateAsync({ id: s.id, companyId })
      toast('Shift deleted', 'success')
    } catch (e) {
      // 409 SHIFT_IN_USE carries a "reassign employees first" message from the API.
      toast((e as Error)?.message ?? 'Failed to delete shift', 'error')
    }
  }

  const isPending = createShift.isPending || updateShift.isPending

  // No Status column: /v1/shifts only ever returns active policies (delete is a
  // soft-delete that drops the row from the list), so an Active/Inactive pill
  // here would always read "Active".
  const cols: Column<ShiftPolicy>[] = [
    {
      key: 'name', header: 'Shift',
      cell: (s) => (
        <div>
          <p className="font-semibold text-text-primary text-sm">{s.name}</p>
          <p className="mt-0.5 text-xs capitalize text-text-tertiary">{(s.shiftType ?? '').toLowerCase()}</p>
        </div>
      ),
    },
    {
      key: 'schedule', header: 'Schedule', hideBelow: 'md',
      cell: (s) => (
        <span className="text-sm text-text-secondary">
          {s.startTime && s.endTime ? `${hhmm(s.startTime)} – ${hhmm(s.endTime)}` : '—'}
        </span>
      ),
    },
    {
      key: 'grace', header: 'Grace',
      cell: (s) => <span className="text-sm tabular-nums text-text-secondary">{s.gracePeriodMinutes} min</span>,
    },
    {
      key: 'hours', header: 'Hours/Day', hideBelow: 'md',
      cell: (s) => (
        <span className="text-sm tabular-nums text-text-secondary">
          {s.workingHoursPerDay != null ? `${s.workingHoursPerDay} h` : '—'}
        </span>
      ),
    },
    {
      key: 'actions', header: '',
      cell: (s) => (
        <Can code={P.ATTENDANCE_REGULARIZATION_APPROVE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(s)} aria-label={`Edit shift ${s.name}`} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(s)} aria-label={`Delete shift ${s.name}`} className={BTN_DEL}><Trash2 size={13} /></button>
          </div>
        </Can>
      ),
    },
  ]

  if (!activeCompany) return (
    <EmptyState variant="first-run" title="No company selected"
      description="Select a company above to manage its work shifts." />
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-xl text-xs leading-relaxed text-text-tertiary">
          These are the shift timings attendance is scored against, shared with the mobile app.
          The <strong>grace period</strong> is how many minutes after the start time a check-in still
          counts as on time — anything later is marked Late.
        </p>
        <Can code={P.ATTENDANCE_REGULARIZATION_APPROVE}>
          <button onClick={openAdd} className={clsx(BTN_ADD, 'shrink-0')}><Plus size={15} /> Add Shift</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={shifts} getRowKey={(s) => s.id}
          className="[&_tbody_td]:py-2.5" isLoading={isLoading} emptyTitle="No shifts configured"
          emptyDescription="Define work shifts and schedules for your teams." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Shift' : 'Add Shift'}>
        <div className="space-y-4">
          <Field label="Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. General Shift" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Start Time"><Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
            <Field label="End Time"><Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Grace (min)">
              <Input type="number" min={GRACE_MIN} max={GRACE_MAX} value={form.gracePeriodMinutes}
                onChange={(e) => set('gracePeriodMinutes', e.target.value)} />
              <p className="mt-1 text-[11px] text-text-tertiary">
                {GRACE_MIN}–{GRACE_MAX}. Check-ins inside this window are not marked Late.
              </p>
            </Field>
            <Field label="Working Hours / Day">
              <Input type="number" step="0.5" min={HOURS_MIN} max={HOURS_MAX} value={form.workingHoursPerDay}
                onChange={(e) => set('workingHoursPerDay', e.target.value)} />
              <p className="mt-1 text-[11px] text-text-tertiary">
                {HOURS_MIN}–{HOURS_MAX}. The daily target for this shift.
              </p>
            </Field>
          </div>
          <Field label="Shift Type *">
            <HrSelect
              value={form.shiftType}
              onChange={(v) => set('shiftType', v as ShiftType)}
              options={SHIFT_TYPES}
            />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.overtimeApplicable}
              onChange={(e) => set('overtimeApplicable', e.target.checked)}
              className="accent-primary w-4 h-4" />
            <span className="text-sm text-text-secondary">Overtime applicable</span>
          </label>
          {form.overtimeApplicable && (
            <Field label="Overtime Rate (×)">
              <Input type="number" step="0.1" min={OT_MIN} max={OT_MAX} value={form.overtimeMultiplier}
                onChange={(e) => set('overtimeMultiplier', e.target.value)} />
              <p className="mt-1 text-[11px] text-text-tertiary">
                Stored as the configured rate — payroll does not apply it automatically yet.
              </p>
            </Field>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.ATTENDANCE_REGULARIZATION_APPROVE}>
              <button onClick={handleSave} disabled={isPending} className={BTN_PRIMARY}>
                {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </Can>
          </div>
        </div>
      </SlideModal>
    </div>
  )
}

// ── Main OrgSetup ─────────────────────────────────────────────────────────────

export const OrgSetup: React.FC = () => {
  const [tab, setTab] = useState<Tab>('companies')
  const { data: companies = [] } = useCompanies()
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')

  const activeCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Master"
        title="Organisation Setup"
        subtitle="Manage companies, branches, departments, designations, grades, employment types, and shifts"
      />

      <HrTabs
        tabs={TABS.map(({ key, label, icon: Icon }) => ({
          key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon size={15} />
              {label}
            </span>
          ),
        }))}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        className="!mb-0"
      />

      {tab !== 'companies' && companies.length > 0 && (
        <div className="ut-card ut-card-sm flex items-center gap-3 px-4 py-2.5">
          <Building2 size={14} className="text-text-tertiary flex-shrink-0" />
          <span className="text-sm text-text-secondary">Viewing for:</span>
          <select value={activeCompany?.id ?? ''} onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="ut-select ut-select-sm w-auto min-w-[180px]">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <HrTabPanel tabKey={tab}>
        <div className="ut-card ut-card-lg p-5">
          {tab === 'companies'        && <CompaniesTab />}
          {tab === 'branches'         && <BranchesTab activeCompany={activeCompany} />}
          {tab === 'departments'      && <DepartmentsTab activeCompany={activeCompany} />}
          {tab === 'designations'     && <DesignationsTab activeCompany={activeCompany} />}
          {tab === 'grades'           && <GradesTab activeCompany={activeCompany} />}
          {tab === 'employment-types' && <EmploymentTypesTab activeCompany={activeCompany} />}
          {tab === 'shifts'           && <ShiftsTab activeCompany={activeCompany} />}
        </div>
      </HrTabPanel>
    </div>
  )
}
