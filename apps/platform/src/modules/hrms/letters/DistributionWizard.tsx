import React, { useMemo, useState } from 'react'
import { X, ChevronRight, ChevronLeft, AlertTriangle, Loader2, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { useLetterTemplates } from './api/useLetters'
import { useCompanies, useDepartments, useDesignations } from '../api/useOrg'
import { useEmployeeDirectory } from '../api/useWorkforce'
import { useCreateDistribution, type RecipientFilterType, type CreateDistributionRequest } from './api/useDistribution'
import { RecipientPicker } from './components/RecipientPicker'

type Step = 1 | 2 | 3 | 4

// The backend BY_EMPLOYMENT_TYPE filter resolves values via the WorkforceEmployee
// EmploymentType enum, so offer exactly those values.
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'] as const
const FILTERS: { value: RecipientFilterType; label: string }[] = [
  { value: 'ALL_EMPLOYEES', label: 'All employees' },
  { value: 'BY_DEPARTMENT', label: 'By department' },
  { value: 'BY_DESIGNATION', label: 'By designation' },
  { value: 'BY_EMPLOYMENT_TYPE', label: 'By employment type' },
  { value: 'CUSTOM_LIST', label: 'Custom list' },
]

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={clsx('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
        active ? 'bg-[#FF9D00] border-[#FF9D00] text-white' : 'bg-white border-border text-text-secondary hover:text-text-primary hover:border-[#FFD68A]')}>
      {label}
    </button>
  )
}

export function DistributionWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (jobId: string) => void }) {
  const { toast } = useToast()
  const create = useCreateDistribution()

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: templatesPage } = useLetterTemplates()
  const templates = (templatesPage?.content ?? []).filter((t) => t.active)
  const { data: departments = [] } = useDepartments(companyId)
  const { data: designations = [] } = useDesignations(companyId)
  // Fetch tenant-wide (no companyId): the backend resolves ALL_EMPLOYEES /
  // BY_EMPLOYMENT_TYPE across the whole tenant, so the client-side recipient
  // count must too, or it diverges once there's more than one company.
  // BY_DEPARTMENT / BY_DESIGNATION still narrow by the (company-scoped) dept/
  // desig ids selected, so a tenant-wide source is correct for every filter type.
  const { data: empPage } = useEmployeeDirectory({ pageSize: 500 })
  const employees = empPage?.content ?? []

  const [step, setStep] = useState<Step>(1)
  const [templateId, setTemplateId] = useState('')
  const [filterType, setFilterType] = useState<RecipientFilterType>('ALL_EMPLOYEES')
  const [deptIds, setDeptIds] = useState<Set<string>>(new Set())
  const [desigIds, setDesigIds] = useState<Set<string>>(new Set())
  const [empTypes, setEmpTypes] = useState<Set<string>>(new Set())
  const [customIds, setCustomIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const selectedTemplate = templates.find((t) => t.id === templateId)

  // Resolve targeted employees client-side for the live count + no-email warning.
  const targeted = useMemo(() => {
    switch (filterType) {
      case 'ALL_EMPLOYEES': return employees
      case 'BY_DEPARTMENT': return employees.filter((e) => e.departmentId && deptIds.has(e.departmentId))
      case 'BY_DESIGNATION': return employees.filter((e) => e.designationId && desigIds.has(e.designationId))
      case 'BY_EMPLOYMENT_TYPE': return employees.filter((e) => e.employmentType && empTypes.has(e.employmentType))
      case 'CUSTOM_LIST': return employees.filter((e) => customIds.has(e.id))
      default: return []
    }
  }, [filterType, employees, deptIds, desigIds, empTypes, customIds])
  const noEmail = targeted.filter((e) => !e.email).length

  const buildFilter = (): CreateDistributionRequest['recipientFilter'] => {
    switch (filterType) {
      case 'BY_DEPARTMENT': return { type: 'BY_DEPARTMENT', values: [...deptIds] }
      case 'BY_DESIGNATION': return { type: 'BY_DESIGNATION', values: [...desigIds] }
      case 'BY_EMPLOYMENT_TYPE': return { type: 'BY_EMPLOYMENT_TYPE', values: [...empTypes] }
      case 'CUSTOM_LIST': return { type: 'CUSTOM_LIST', employeeIds: [...customIds] }
      default: return { type: 'ALL_EMPLOYEES' }
    }
  }

  const canNext = step === 1 ? !!templateId : step === 2 ? targeted.length > 0 : step === 3 ? !!title.trim() : true

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setter(next)
  }

  const handleSend = async () => {
    try {
      const job = await create.mutateAsync({
        templateId,
        title: title.trim(),
        customMessage: message || undefined,
        subjectOverride: subject.trim() || undefined,
        recipientFilter: buildFilter(),
      })
      toast('Distribution started', 'success')
      onCreated(job.id)
    } catch (err) {
      toast((err as Error)?.message ?? 'Failed to start distribution', 'error')
    }
  }

  const STEPS = ['Template', 'Recipients', 'Message', 'Confirm']

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-xl bg-white border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold">New Distribution</h3>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg"><X size={16} /></button>
        </div>

        <div className="flex gap-1 px-5 py-3 border-b border-border">
          {STEPS.map((label, i) => (
            <div key={label} className={clsx('flex-1 text-center text-xs font-medium py-1.5 rounded-full',
              step === i + 1 ? 'bg-[#FF9D00] text-white' : i + 1 < step ? 'text-[#C16E00]' : 'text-text-secondary')}>
              {i + 1}. {label}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1 — Template */}
          {step === 1 && (
            <>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Letter template</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/30">
                <option value="">{templates.length === 0 ? 'No active templates — create one first' : 'Select a template…'}</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {selectedTemplate && (
                <div className="mt-3 p-3 bg-bg-base border border-border rounded-xl text-sm">
                  <p className="text-text-secondary text-xs">Subject preview</p>
                  <p className="text-text-primary mt-0.5">{selectedTemplate.subject}</p>
                  <p className="text-text-secondary text-xs mt-2">Merge fields like {'{{employee.firstName}}'} are filled per recipient.</p>
                </div>
              )}
            </>
          )}

          {/* Step 2 — Recipients */}
          {step === 2 && (
            <>
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((f) => <Chip key={f.value} active={filterType === f.value} label={f.label} onClick={() => setFilterType(f.value)} />)}
              </div>

              {filterType === 'BY_DEPARTMENT' && (
                <div className="flex flex-wrap gap-2">
                  {departments.length === 0 ? <p className="text-sm text-text-secondary">No departments.</p> :
                    departments.map((d) => <Chip key={d.id} active={deptIds.has(d.id)} label={d.name} onClick={() => toggle(deptIds, d.id, setDeptIds)} />)}
                </div>
              )}
              {filterType === 'BY_DESIGNATION' && (
                <div className="flex flex-wrap gap-2">
                  {designations.length === 0 ? <p className="text-sm text-text-secondary">No designations.</p> :
                    designations.map((d) => <Chip key={d.id} active={desigIds.has(d.id)} label={d.title} onClick={() => toggle(desigIds, d.id, setDesigIds)} />)}
                </div>
              )}
              {filterType === 'BY_EMPLOYMENT_TYPE' && (
                <div className="flex flex-wrap gap-2">
                  {EMPLOYMENT_TYPES.map((t) => <Chip key={t} active={empTypes.has(t)} label={t.replace('_', ' ')} onClick={() => toggle(empTypes, t, setEmpTypes)} />)}
                </div>
              )}
              {filterType === 'CUSTOM_LIST' && (
                <RecipientPicker employees={employees} selected={customIds} onChange={setCustomIds} />
              )}

              <div className="p-3 bg-[#FFF4E1] border border-[#FFD68A] rounded-xl text-sm text-[#C16E00]">
                This will send to <strong>{targeted.length}</strong> employee{targeted.length === 1 ? '' : 's'}.
                {noEmail > 0 && <span className="text-amber-700"> {noEmail} have no email on file and will be skipped.</span>}
              </div>
            </>
          )}

          {/* Step 3 — Message */}
          {step === 3 && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Title <span className="text-danger">*</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. November 2026 Salary Slips"
                  className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Email subject (optional)</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Defaults to a standard subject"
                  className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Message to recipients</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
                  placeholder="e.g. Please find attached your salary slip for November 2026."
                  className="w-full bg-white border border-border/60 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/30 resize-none" />
                <p className="text-xs text-text-secondary mt-1">Sent in the email body above the attached document.</p>
              </div>
            </>
          )}

          {/* Step 4 — Confirm */}
          {step === 4 && (
            <>
              <div className="space-y-2 text-sm">
                <Row label="Template" value={selectedTemplate?.name ?? '—'} />
                <Row label="Recipients" value={`${targeted.length} employee${targeted.length === 1 ? '' : 's'}${noEmail > 0 ? ` (${noEmail} skipped — no email)` : ''}`} />
                <Row label="Title" value={title} />
                {message && <Row label="Message" value={message.length > 80 ? message.slice(0, 80) + '…' : message} />}
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2.5">
                <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  This will send <strong>{targeted.length - noEmail}</strong> email{targeted.length - noEmail === 1 ? '' : 's'} immediately. This cannot be undone.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t border-border">
          {step > 1 && (
            <button onClick={() => setStep((s) => (s - 1) as Step)}
              className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm flex items-center gap-1">
              <ChevronLeft size={14} /> Back
            </button>
          )}
          {step < 4 ? (
            <button onClick={() => setStep((s) => (s + 1) as Step)} disabled={!canNext}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#FF9D00] hover:bg-[#E08A00] disabled:opacity-40 text-white font-medium rounded-xl text-sm">
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button onClick={handleSend} disabled={create.isPending || targeted.length - noEmail < 1}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#FF9D00] hover:bg-[#E08A00] disabled:opacity-40 text-white font-medium rounded-xl text-sm">
              {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send to {targeted.length - noEmail} employee{targeted.length - noEmail === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border/50">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary font-medium text-right">{value}</span>
    </div>
  )
}
