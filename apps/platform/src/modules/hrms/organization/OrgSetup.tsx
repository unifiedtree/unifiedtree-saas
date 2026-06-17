import React, { useState, useMemo } from 'react'
import { Plus, Building2, GitBranch, Layers, Award, Trash2, X, MapPin, BarChart3, Briefcase, Clock, Pencil } from 'lucide-react'
import { clsx } from 'clsx'
import { Can, P } from '@unifiedtree/sdk'
import { Badge, DataTable, EmptyState } from '@unifiedtree/ui-kit'
import type { Column, SortState } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import {
  useCompanies, useCreateCompany, useUpdateCompany, useArchiveCompany,
  useBranches, useCreateBranch, useArchiveBranch,
  useDepartments, useCreateDepartment, useArchiveDepartment, useSetDepartmentHead,
  useDesignations, useCreateDesignation, useUpdateDesignation, useArchiveDesignation,
  useGrades, useCreateGrade, useUpdateGrade, useDeleteGrade,
  useEmploymentTypes, useCreateEmploymentType, useUpdateEmploymentType, useDeleteEmploymentType,
  useShifts, useCreateShift, useUpdateShift, useDeleteShift,
  type Company, type Designation, type Grade, type EmploymentTypeRecord, type Shift,
} from '../api/useOrg'
import { useEmployeeDirectory } from '../api/useWorkforce'

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

// ── Day bitmask helpers (bit 0 = Sun, bit 6 = Sat) ───────────────────────────

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_BITS   = [1, 2, 4, 8, 16, 32, 64]

function DayChips({ bitmask }: { bitmask: number }) {
  return (
    <div className="flex gap-0.5">
      {DAY_LABELS.map((d, i) => (
        <span key={i} className={clsx(
          'w-5 h-5 rounded-full text-[10px] font-medium flex items-center justify-center',
          bitmask & DAY_BITS[i] ? 'bg-primary/10 text-primary' : 'bg-bg-surface text-text-tertiary'
        )}>{d}</span>
      ))}
    </div>
  )
}

function DayToggle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((d, i) => (
        <button key={i} type="button"
          onClick={() => onChange(value ^ DAY_BITS[i])}
          className={clsx(
            'w-8 h-8 rounded-full text-xs font-medium transition-colors',
            value & DAY_BITS[i] ? 'bg-primary text-text-primary' : 'bg-bg-surface text-text-tertiary hover:text-text-primary'
          )}
        >{d}</button>
      ))}
    </div>
  )
}

// ── Shared form primitives ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
    />
  )
}

function SlideModal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-[100] bg-text-primary/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-border-default flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h3 className="text-text-primary font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-bg-surface">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  )
}

const BTN_PRIMARY = 'flex-1 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-text-primary font-medium rounded-xl text-sm transition-colors'
const BTN_CANCEL  = 'flex-1 py-2.5 border border-border-default text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors'
const BTN_ADD     = 'flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover disabled:opacity-40 text-text-primary text-sm font-medium rounded-xl transition-colors'
const BTN_ICON    = 'p-1.5 text-text-tertiary hover:text-text-secondary transition-colors'
const BTN_DEL     = 'p-1.5 text-text-tertiary hover:text-red-400 transition-colors'

// ── Companies Tab ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const { toast } = useToast()
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
    try { await archiveCompany.mutateAsync(co.id); toast('Company archived', 'success') }
    catch { toast('Failed to archive company', 'error') }
  }

  const isPending = createCompany.isPending || updateCompany.isPending

  const cols: Column<Company>[] = [
    {
      key: 'name', header: 'Company',
      cell: (co) => (
        <div>
          <p className="font-medium text-text-primary text-sm">{co.name}</p>
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
      cell: (co) => <span className="text-sm text-text-secondary">{co.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (co) => <Badge tone={co.active ? 'success' : 'default'}>{co.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (co) => (
        <Can code={P.ORG_COMPANY_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(co)} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleArchive(co)} className={BTN_DEL}><Trash2 size={13} /></button>
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
          isLoading={isLoading} emptyTitle="No companies yet"
          emptyDescription="Add your first company to get started." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Company' : 'Add Company'}>
        <div className="space-y-4">
          <Field label="Company Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme Pvt Ltd" /></Field>
          <Field label="Legal Name"><Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Registered legal name" /></Field>
          <Field label="Industry"><Input value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Technology" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Currency"><Input value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
            <Field label="Country"><Input value={form.country} onChange={(e) => set('country', e.target.value)} /></Field>
          </div>
          <div className="flex gap-3 pt-2">
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

// ── Branches Tab ──────────────────────────────────────────────────────────────

interface CompanyProp { activeCompany?: Company }

function BranchesTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
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

  const handleArchive = async (id: string) => {
    try { await archiveBranch.mutateAsync(id); toast('Branch archived', 'success') }
    catch { toast('Failed to archive branch', 'error') }
  }

  type Br = typeof branches[number]
  const cols: Column<Br>[] = [
    {
      key: 'name', header: 'Branch',
      cell: (br) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary text-sm">{br.name}</span>
          {br.headquarters && <Badge tone="warning">HQ</Badge>}
        </div>
      ),
    },
    {
      key: 'location', header: 'Location', hideBelow: 'md',
      cell: (br) => <span className="text-sm text-text-secondary">{[br.city, br.state, br.country].filter(Boolean).join(', ') || '—'}</span>,
    },
    {
      key: 'employees', header: 'Employees', hideBelow: 'lg',
      cell: (br) => <span className="text-sm text-text-secondary">{br.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (br) => <Badge tone={br.active ? 'success' : 'default'}>{br.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (br) => (
        <Can code={P.ORG_COMPANY_WRITE}>
          <button onClick={() => handleArchive(br.id)} className={BTN_DEL}><Trash2 size={14} /></button>
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
          isLoading={isLoading} emptyTitle="No branches yet"
          emptyDescription="Add a branch to map your office locations." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title="Add Branch">
        <div className="space-y-4">
          <Field label="Branch Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Mumbai Office" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. MUM" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="flex gap-3 pt-2">
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
  const { data: departments = [], isLoading, error, refetch } = useDepartments(activeCompany?.id ?? '')
  const { data: empPage } = useEmployeeDirectory({ companyId: activeCompany?.id, pageSize: 200 })
  const employees = empPage?.content ?? []
  const createDept = useCreateDepartment()
  const archiveDept = useArchiveDepartment()
  const setHead = useSetDepartmentHead()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', description: '', departmentHeadEmployeeId: '' })
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const empLabel = (id?: string) => {
    const e = employees.find((x) => x.id === id)
    return e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : ''
  }

  const handleCreate = async () => {
    if (!activeCompany || !form.name.trim()) return
    try {
      await createDept.mutateAsync({
        companyId: activeCompany.id,
        name: form.name,
        code: form.code || undefined,
        description: form.description || undefined,
        departmentHeadEmployeeId: form.departmentHeadEmployeeId || undefined,
      })
      toast('Department created', 'success')
      setOpen(false)
      setForm({ name: '', code: '', description: '', departmentHeadEmployeeId: '' })
    } catch { toast('Failed to create department', 'error') }
  }

  const handleArchive = async (id: string) => {
    try { await archiveDept.mutateAsync(id); toast('Department archived', 'success') }
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
      cell: (d) => <span className="font-medium text-text-primary text-sm">{d.name}</span>,
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
            className="bg-bg-surface border border-border-default rounded-lg px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-indigo-500 max-w-[10rem]">
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
      cell: (d) => <span className="text-sm text-text-secondary">{d.employeeCount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (d) => <Badge tone={d.active ? 'success' : 'default'}>{d.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (d) => (
        <Can code={P.HRMS_DEPARTMENT_WRITE}>
          <button onClick={() => handleArchive(d.id)} className={BTN_DEL}><Trash2 size={14} /></button>
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
          isLoading={isLoading} emptyTitle="No departments yet"
          emptyDescription="Structure your company by adding departments." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title="Add Department">
        <div className="space-y-4">
          <Field label="Department Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Engineering" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. ENG" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>
          <Field label="Department Head">
            <select value={form.departmentHeadEmployeeId} onChange={(e) => set('departmentHeadEmployeeId', e.target.value)}
              className="w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-indigo-500 transition-colors">
              <option value="">None</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{[emp.firstName, emp.lastName].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </Field>
          <div className="flex gap-3 pt-2">
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

  const handleArchive = async (id: string) => {
    try { await archiveDesig.mutateAsync(id); toast('Designation archived', 'success') }
    catch { toast('Failed to archive designation', 'error') }
  }

  const isPending = createDesig.isPending || updateDesig.isPending

  type Desig = typeof designations[number]
  const cols: Column<Desig>[] = [
    {
      key: 'title', header: 'Title',
      cell: (d) => <span className="font-medium text-text-primary text-sm">{d.title}</span>,
    },
    {
      key: 'grade', header: 'Grade', hideBelow: 'md',
      cell: (d) => <span className="text-sm text-text-secondary">{d.grade || '—'}</span>,
    },
    {
      key: 'headcount', header: 'Headcount', hideBelow: 'lg',
      cell: (d) => <span className="text-sm text-text-secondary">{d.headcount ?? 0}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (d) => <Badge tone={d.active ? 'success' : 'default'}>{d.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (d) => (
        <Can code={P.HRMS_DESIGNATION_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(d)} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleArchive(d.id)} className={BTN_DEL}><Trash2 size={13} /></button>
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
          isLoading={isLoading} emptyTitle="No designations yet"
          emptyDescription="Define roles and job titles for your employees." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Designation' : 'Add Designation'}>
        <div className="space-y-4">
          <Field label="Title *"><Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Senior Engineer" /></Field>
          <Field label="Grade"><Input value={form.grade} onChange={(e) => set('grade', e.target.value)} placeholder="e.g. L4" /></Field>
          <div className="flex gap-3 pt-2">
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
          <p className="font-medium text-text-primary text-sm">{g.name}</p>
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
      cell: (g) => <Badge tone={g.active ? 'success' : 'default'}>{g.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (g) => (
        <Can code={P.HRMS_GRADE_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(g)} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(g)} className={BTN_DEL}><Trash2 size={13} /></button>
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
          isLoading={isLoading} sortState={sort} onSortChange={setSort}
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
          <div className="flex gap-3 pt-2">
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
    try { await deleteType.mutateAsync({ id: t.id, companyId: activeCompany.id }); toast('Employment type deleted', 'success') }
    catch { toast('Failed to delete employment type', 'error') }
  }

  const isPending = createType.isPending || updateType.isPending

  const cols: Column<EmploymentTypeRecord>[] = [
    {
      key: 'name', header: 'Name',
      cell: (t) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary text-sm">{t.name}</span>
          {t.system && <Badge tone="accent">System</Badge>}
        </div>
      ),
    },
    {
      key: 'code', header: 'Code', hideBelow: 'md',
      cell: (t) => <span className="text-sm text-text-secondary">{t.code || '—'}</span>,
    },
    {
      key: 'payroll', header: 'Payroll Eligible', hideBelow: 'lg',
      cell: (t) => <Badge tone={t.payrollEligible ? 'success' : 'default'}>{t.payrollEligible ? 'Yes' : 'No'}</Badge>,
    },
    {
      key: 'status', header: 'Status',
      cell: (t) => <Badge tone={t.active ? 'success' : 'default'}>{t.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (t) => t.system ? null : (
        <Can code={P.HRMS_EMPLOYMENT_TYPE_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(t)} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(t)} className={BTN_DEL}><Trash2 size={13} /></button>
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
          isLoading={isLoading} emptyTitle="No employment types"
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
          <div className="flex gap-3 pt-2">
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

function ShiftsTab({ activeCompany }: CompanyProp) {
  const { toast } = useToast()
  const { data: shifts = [], isLoading, error, refetch } = useShifts(activeCompany?.id ?? '')
  const createShift = useCreateShift()
  const updateShift = useUpdateShift()
  const deleteShift = useDeleteShift()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const emptyForm = { name: '', code: '', startTime: '09:00', endTime: '18:00', breakMinutes: '30', graceMinutes: '10', daysBitmask: 62, isNightShift: false }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (s: Shift) => {
    setEditing(s)
    setForm({
      name: s.name, code: s.code ?? '',
      startTime: s.startTime ?? '09:00', endTime: s.endTime ?? '18:00',
      breakMinutes: String(s.breakMinutes), graceMinutes: String(s.graceMinutes),
      daysBitmask: s.daysBitmask, isNightShift: s.nightShift,
    })
    setOpen(true)
  }
  const set = (k: string, v: string | number | boolean) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!activeCompany || !form.name.trim()) return
    try {
      const payload = {
        companyId: activeCompany.id,
        name: form.name,
        code: form.code || undefined,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        breakMinutes: Number(form.breakMinutes) || 30,
        graceMinutes: Number(form.graceMinutes) || 10,
        daysBitmask: form.daysBitmask,
        isNightShift: form.isNightShift,
      }
      if (editing) {
        await updateShift.mutateAsync({ id: editing.id, ...payload })
        toast('Shift updated', 'success')
      } else {
        await createShift.mutateAsync(payload)
        toast('Shift created', 'success')
      }
      setOpen(false)
    } catch { toast('Failed to save shift', 'error') }
  }

  const handleDelete = async (s: Shift) => {
    if (!activeCompany) return
    try { await deleteShift.mutateAsync({ id: s.id, companyId: activeCompany.id }); toast('Shift deleted', 'success') }
    catch { toast('Failed to delete shift', 'error') }
  }

  const isPending = createShift.isPending || updateShift.isPending

  const cols: Column<Shift>[] = [
    {
      key: 'name', header: 'Shift',
      cell: (s) => (
        <div>
          <p className="font-medium text-text-primary text-sm">{s.name}</p>
          {s.nightShift && <Badge tone="info" className="mt-0.5">Night</Badge>}
        </div>
      ),
    },
    {
      key: 'schedule', header: 'Schedule', hideBelow: 'md',
      cell: (s) => (
        <span className="text-sm text-text-secondary">
          {s.startTime && s.endTime ? `${s.startTime} – ${s.endTime}` : '—'}
        </span>
      ),
    },
    {
      key: 'days', header: 'Days',
      cell: (s) => <DayChips bitmask={s.daysBitmask} />,
    },
    {
      key: 'status', header: 'Status',
      cell: (s) => <Badge tone={s.active ? 'success' : 'default'}>{s.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '',
      cell: (s) => (
        <Can code={P.HRMS_SHIFT_WRITE}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openEdit(s)} className={BTN_ICON}><Pencil size={13} /></button>
            <button onClick={() => handleDelete(s)} className={BTN_DEL}><Trash2 size={13} /></button>
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
      <div className="flex justify-end">
        <Can code={P.HRMS_SHIFT_WRITE}>
          <button onClick={openAdd} className={BTN_ADD}><Plus size={15} /> Add Shift</button>
        </Can>
      </div>

      {error ? (
        <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />
      ) : (
        <DataTable columns={cols} data={shifts} getRowKey={(s) => s.id}
          isLoading={isLoading} emptyTitle="No shifts configured"
          emptyDescription="Define work shifts and schedules for your teams." />
      )}

      <SlideModal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Shift' : 'Add Shift'}>
        <div className="space-y-4">
          <Field label="Name *"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. General Shift" /></Field>
          <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. GEN" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Time"><Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
            <Field label="End Time"><Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Break (min)"><Input type="number" min="0" value={form.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value)} /></Field>
            <Field label="Grace (min)"><Input type="number" min="0" value={form.graceMinutes} onChange={(e) => set('graceMinutes', e.target.value)} /></Field>
          </div>
          <Field label="Working Days">
            <DayToggle value={form.daysBitmask} onChange={(v) => set('daysBitmask', v)} />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isNightShift}
              onChange={(e) => set('isNightShift', e.target.checked)}
              className="accent-primary w-4 h-4" />
            <span className="text-sm text-text-secondary">Night shift</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setOpen(false)} className={BTN_CANCEL}>Cancel</button>
            <Can code={P.HRMS_SHIFT_WRITE}>
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary font-heading tracking-tight">Organisation Setup</h1>
          <p className="text-text-secondary text-sm sm:text-base font-medium mt-1.5">Manage companies, branches, departments, designations, grades, employment types, and shifts</p>
        </div>
      </div>

      {tab !== 'companies' && companies.length > 0 && (
        <div className="flex items-center gap-3 bg-bg-surface/40 border border-border-default rounded-xl px-4 py-2.5">
          <Building2 size={14} className="text-text-tertiary flex-shrink-0" />
          <span className="text-sm text-text-secondary">Viewing for:</span>
          <select value={activeCompany?.id ?? ''} onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="flex-1 bg-transparent text-text-primary text-sm focus:outline-none">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div className="flex gap-1 bg-bg-surface p-1.5 rounded-xl border border-border-default overflow-x-auto scrollbar-hide w-fit max-w-full shadow-sm">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx(
              'flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all',
              tab === key ? 'bg-white text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary hover:bg-white/50'
            )}>
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'companies'        && <CompaniesTab />}
        {tab === 'branches'         && <BranchesTab activeCompany={activeCompany} />}
        {tab === 'departments'      && <DepartmentsTab activeCompany={activeCompany} />}
        {tab === 'designations'     && <DesignationsTab activeCompany={activeCompany} />}
        {tab === 'grades'           && <GradesTab activeCompany={activeCompany} />}
        {tab === 'employment-types' && <EmploymentTypesTab activeCompany={activeCompany} />}
        {tab === 'shifts'           && <ShiftsTab activeCompany={activeCompany} />}
      </div>
    </div>
  )
}
