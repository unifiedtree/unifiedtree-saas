import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react'
import { useToast } from '@/shared/hooks/useToast'
import { Skeleton } from '@unifiedtree/ui-kit'
import { EmptyState } from '@/shared/components/EmptyState'
import {
  HrPageHeader,
  HrButton,
  HrStatCard,
  TableCard,
} from '@/shared/components/hr'
import { useCompanies } from '../api/useOrg'
import {
  countValidRows,
  parseErrors,
  useCommitBulkImport,
  useDownloadTemplate,
  useValidateBulkImport,
} from '../api/useBulkImport'
import { useAuthStore } from '@unifiedtree/sdk'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function validateFile(f: File): string | null {
  if (f.size > MAX_FILE_SIZE) {
    return `File is ${(f.size / 1024 / 1024).toFixed(1)} MB — exceeds the 10 MB limit.`
  }
  const ext = f.name.toLowerCase().split('.').pop()
  if (!['csv', 'xlsx'].includes(ext ?? '')) {
    return `Only .csv and .xlsx files are accepted. Received: .${ext}`
  }
  return null
}

// ── Step indicator ────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 'done'

const STEPS = [
  { n: 1, label: 'Download template' },
  { n: 2, label: 'Upload & validate' },
  { n: 3, label: 'Confirm import' },
]

function Stepper({ current }: { current: WizardStep }) {
  const active = current === 'done' ? 3 : current
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors',
                s.n < active || current === 'done'
                  ? 'bg-[#15803D] border-[#15803D] text-white'
                  : s.n === active
                  ? 'bg-[#FF9D00] border-[#FF9D00] text-white'
                  : 'bg-white border-border-default text-text-tertiary',
              )}
            >
              {s.n < active || current === 'done' ? <Check size={12} /> : s.n}
            </div>
            <span
              className={clsx(
                'text-sm font-medium hidden sm:block',
                s.n === active ? 'text-text-primary' : s.n < active ? 'text-[#15803D]' : 'text-text-tertiary',
              )}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={clsx(
                'flex-1 h-px mx-3',
                s.n < active ? 'bg-[#FFD68A]' : 'bg-border-default',
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  file: File | null
  disabled: boolean
  onFile: (f: File) => void
}

function DropZone({ file, disabled, onFile }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const dropped = e.dataTransfer.files[0]
    if (dropped) onFile(dropped)
  }

  return (
    <label
      className={clsx(
        'block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        isDragging
          ? 'border-[#FF9D00] bg-[#FFF4E1]'
          : file
          ? 'border-[#15803D]/50 bg-[#DCFCE7]/40'
          : 'border-border-default hover:border-[#FFD68A] bg-bg-base',
      )}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onFile(picked)
          e.target.value = ''
        }}
      />
      {file ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-[#DCFCE7] rounded-xl flex items-center justify-center">
            <FileUp size={20} className="text-[#15803D]" />
          </div>
          <p className="text-text-primary font-medium text-sm">{file.name}</p>
          <p className="text-text-secondary text-xs">{(file.size / 1024).toFixed(0)} KB</p>
          {!disabled && (
            <p className="text-text-secondary text-xs mt-1">Click to change file</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-bg-base rounded-xl flex items-center justify-center">
            <Upload size={20} className="text-text-secondary" />
          </div>
          <p className="text-text-primary text-sm font-medium">
            Drag & drop your file here, or click to browse
          </p>
          <p className="text-text-secondary text-xs">Accepts .csv or .xlsx · Max 10 MB</p>
        </div>
      )}
    </label>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export const EmployeeImport: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()

  const { data: companies = [] } = useCompanies()
  const tenantName = useAuthStore((s) => s.tenant?.displayName ?? 'your organisation')

  const validateMutation = useValidateBulkImport()
  const commitMutation = useCommitBulkImport()
  const downloadMutation = useDownloadTemplate()

  const [step, setStep] = useState<WizardStep>(1)
  const [file, setFile] = useState<File | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [errorFilter, setErrorFilter] = useState('')

  // Auto-select first company
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  // beforeunload guard — only when user has validated data and is about to commit
  useEffect(() => {
    if (step !== 3 || !validateMutation.data) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step, validateMutation.data])

  // ── Derived values ──────────────────────────────────────────────────────────
  const validationResult = validateMutation.data ?? null
  const validRows = validationResult ? countValidRows(validationResult) : 0
  const parsedErrors = validationResult ? parseErrors(validationResult.errors) : []
  const filteredErrors = errorFilter
    ? parsedErrors.filter(
        (e) =>
          e.message.toLowerCase().includes(errorFilter.toLowerCase()) ||
          String(e.rowNumber).includes(errorFilter),
      )
    : parsedErrors
  const displayedErrors = filteredErrors.slice(0, 100)
  const hiddenCount = filteredErrors.length - displayedErrors.length

  const commitResult = commitMutation.data ?? null
  const selectedCompany = companies.find((c) => c.id === companyId) ?? companies[0]

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFileSelect = (f: File) => {
    const err = validateFile(f)
    if (err) { toast(err, 'error'); return }
    setFile(f)
    validateMutation.reset()
    setErrorFilter('')
  }

  const handleValidate = async () => {
    if (!file || !companyId) return
    try {
      const result = await validateMutation.mutateAsync({ file, companyId })
      if (result.totalRows === 0) {
        toast('File appears to be empty. Check the template structure.', 'warning')
        return
      }
      if (result.totalRows > 1000) {
        toast(
          `File has ${result.totalRows} rows — maximum is 1,000 rows per import. Split the file and try again.`,
          'error',
        )
        return
      }
    } catch {
      // error already in validateMutation.error
    }
  }

  const handleCommit = async () => {
    if (!file || !companyId) return
    try {
      await commitMutation.mutateAsync({ file, companyId })
      setStep('done')
    } catch {
      setStep('done')
    }
  }

  const reset = () => {
    setFile(null)
    setErrorFilter('')
    validateMutation.reset()
    commitMutation.reset()
    setStep(1)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl p-6 sm:p-8">
      {/* Header */}
      <nav className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Link to="/hrms" className="hover:text-[#C16E00] transition-colors">HRMS</Link>
        <ChevronRight size={12} />
        <Link to="/hrms/employees" className="hover:text-[#C16E00] transition-colors">Employees</Link>
        <ChevronRight size={12} />
        <span className="text-text-secondary">Import</span>
      </nav>
      <HrPageHeader
        crumb="Employees"
        title="Import employees"
        subtitle="Upload a CSV or XLSX file to add multiple employees at once."
        actions={
          <HrButton variant="ghost" onClick={() => navigate('/hrms/employees')}>
            <ArrowLeft size={15} /> Back to employees
          </HrButton>
        }
      />

      <Stepper current={step} />

      {/* ── Step 1: Download template ────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white border border-border-default rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-text-primary font-semibold text-base mb-1">Download the template</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Use an Excel or CSV file matching the required column headers. Fill in employee rows
              and come back to upload.
            </p>
          </div>

          {/* Column reference */}
          <div className="bg-bg-base rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Required columns</p>
            <div className="flex flex-wrap gap-1.5">
              {['first_name', 'last_name', 'email', 'employment_type', 'date_of_joining'].map((col) => (
                <code key={col} className="px-2 py-0.5 bg-[#FFF4E1] rounded text-xs text-[#C16E00]">{col}</code>
              ))}
            </div>
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mt-2">Optional columns</p>
            <div className="flex flex-wrap gap-1.5">
              {['phone', 'department', 'designation', 'job_title', 'gender', 'date_of_birth'].map((col) => (
                <code key={col} className="px-2 py-0.5 bg-white border border-border-default rounded text-xs text-text-secondary">{col}</code>
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-xs text-text-secondary">
              <li>• employment_type values: FULL_TIME, PART_TIME, CONTRACT, INTERN, CONSULTANT</li>
              <li>• date_of_joining format: yyyy-MM-dd (e.g. 2025-01-15)</li>
              <li>• Max 1,000 rows per import · Max file size: 10 MB</li>
              <li>• Accepted formats: .csv, .xlsx</li>
            </ul>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <HrButton
              onClick={() => downloadMutation.mutate(useAuthStore.getState().tenant?.slug ?? 'tenant')}
              disabled={downloadMutation.isPending}
            >
              <Download size={15} />
              {downloadMutation.isPending ? 'Downloading…' : 'Download template'}
            </HrButton>

            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-[#C16E00] hover:text-[#FF9D00] text-sm font-medium transition-colors"
            >
              I have a file ready → Go to upload
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Upload & validate ────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Company selector */}
          {companies.length > 1 && (
            <div className="bg-white border border-border-default rounded-2xl p-4">
              <label className="block text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                Import into company
              </label>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value)
                  validateMutation.reset()
                }}
                disabled={validateMutation.isPending}
                className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20 transition-colors"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Drop zone */}
          <div className="bg-white border border-border-default rounded-2xl p-6 space-y-4">
            <DropZone
              file={file}
              disabled={validateMutation.isPending}
              onFile={handleFileSelect}
            />

            {file && !validateMutation.isPending && !validateMutation.data && (
              <HrButton onClick={handleValidate} disabled={!companyId}>
                <Check size={15} /> Validate file
              </HrButton>
            )}

            {validateMutation.isPending && (
              <div className="flex items-center gap-3 text-text-secondary text-sm">
                <Loader2 size={16} className="animate-spin text-[#FF9D00]" />
                Validating {file?.name}…
                {validateMutation.uploadProgress > 0 && validateMutation.uploadProgress < 100 && (
                  <span className="text-xs text-text-secondary">{validateMutation.uploadProgress}%</span>
                )}
              </div>
            )}
          </div>

          {/* Validation error */}
          {validateMutation.isError && (
            <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={16} className="text-[#B91C1C] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#B91C1C] text-sm font-medium">Validation request failed</p>
                <p className="text-[#DC2626] text-xs mt-0.5">{(validateMutation.error as Error)?.message}</p>
              </div>
            </div>
          )}

          {/* Validation result */}
          {validationResult && !validateMutation.isPending && (
            <div className="space-y-4">
              {/* Summary stat cards */}
              <div className="grid grid-cols-3 gap-3">
                <HrStatCard
                  icon={<Users size={18} />}
                  color="blue"
                  value={validationResult.totalRows}
                  label="Total rows"
                />
                <HrStatCard
                  icon={<CheckCircle size={18} />}
                  color="green"
                  value={validRows}
                  label="Valid"
                />
                <HrStatCard
                  icon={validationResult.errorCount > 0 ? <XCircle size={18} /> : <CheckCircle size={18} />}
                  color={validationResult.errorCount > 0 ? 'red' : 'green'}
                  value={validationResult.errorCount}
                  label="Errors"
                />
              </div>

              {/* Error table */}
              {validationResult.errorCount > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-text-primary">
                    {parsedErrors.length} validation error{parsedErrors.length !== 1 ? 's' : ''}
                  </p>

                  <TableCard
                    search={{
                      value: errorFilter,
                      onChange: setErrorFilter,
                      placeholder: 'Filter errors…',
                    }}
                    footer={
                      hiddenCount > 0 ? (
                        <p className="text-xs text-text-secondary text-center">
                          … and {hiddenCount} more error{hiddenCount !== 1 ? 's' : ''} not shown.
                          Fix the file and re-validate to see all.
                        </p>
                      ) : undefined
                    }
                  >
                    <table className="hr-table">
                      <thead>
                        <tr>
                          <th className="w-20">Row #</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedErrors.length === 0 ? (
                          <tr>
                            <td colSpan={2} className="text-center text-text-tertiary">
                              No errors match the filter
                            </td>
                          </tr>
                        ) : (
                          displayedErrors.map((row) => (
                            <tr key={row.id}>
                              <td><span className="hr-mono text-xs text-text-secondary">{row.rowNumber || '?'}</span></td>
                              <td><span className="text-[#B91C1C] text-xs">{row.message}</span></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </TableCard>
                </div>
              )}

              {/* Skeleton shown if loading next operation */}
              {validateMutation.isPending && (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 flex-wrap pt-1">
                <HrButton variant="ghost" onClick={reset}>
                  Upload a different file
                </HrButton>
                {validationResult.errorCount === 0 && validRows > 0 && (
                  <HrButton onClick={() => setStep(3)}>
                    Continue with {validRows} valid {validRows === 1 ? 'row' : 'rows'}
                    <ChevronRight size={15} />
                  </HrButton>
                )}
                {validationResult.errorCount > 0 && (
                  <p className="text-text-secondary text-xs">
                    Fix {validationResult.errorCount} error{validationResult.errorCount !== 1 ? 's' : ''} above and re-upload —
                    the backend requires all rows to be valid before any are committed.
                  </p>
                )}
                {validationResult.errorCount === 0 && validRows === 0 && (
                  <p className="text-text-secondary text-xs">
                    File is empty — add some rows and re-upload.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Confirm & commit ─────────────────────────────────────── */}
      {step === 3 && !commitMutation.isPending && !commitMutation.isError && !commitMutation.isSuccess && (
        <div className="bg-white border border-border-default rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-text-primary font-semibold text-base mb-1">Confirm import</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              You are about to create{' '}
              <strong className="text-text-primary">{validRows}</strong>{' '}
              new {validRows === 1 ? 'employee' : 'employees'} in{' '}
              <strong className="text-text-primary">{selectedCompany?.name ?? tenantName}</strong>.
              This cannot be undone — but individual employees can be deleted afterward.
            </p>
          </div>

          {/* Preview collapsible */}
          {validationResult && (
            <details className="group">
              <summary className="cursor-pointer text-sm text-text-secondary hover:text-text-primary select-none transition-colors">
                Preview the {validRows} {validRows === 1 ? 'employee' : 'employees'} being imported
              </summary>
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border-default divide-y divide-border-default">
                {/* NOTE: the backend validate response does not return parsed row data — only error strings.
                    The preview shows the file rows that had no errors. We can only show the row numbers. */}
                <div className="px-4 py-3 text-xs text-text-secondary bg-bg-base">
                  {validRows} row{validRows !== 1 ? 's' : ''} from {file?.name} will be created.
                </div>
                {/* NOTE[backend]: validate endpoint does not return parsed row data.
                    Full row preview requires the backend to include parsed employee objects in BulkImportResult.
                    Until then, we show a concise summary. */}
                <div className="px-4 py-6 text-center text-text-secondary text-xs">
                  <Users size={20} className="mx-auto mb-2 opacity-40" />
                  Detailed row preview requires a backend change to return parsed employee data
                  alongside the validation result. Contact your backend team if this is needed.
                </div>
              </div>
            </details>
          )}

          <div className="flex items-center gap-3">
            <HrButton variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft size={15} /> Back
            </HrButton>
            <HrButton onClick={handleCommit}>
              Confirm — create {validRows} {validRows === 1 ? 'employee' : 'employees'}
            </HrButton>
          </div>
        </div>
      )}

      {/* Committing in progress */}
      {step === 3 && commitMutation.isPending && (
        <div className="bg-white border border-border-default rounded-2xl p-8 flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-[#FF9D00]" />
          <p className="text-text-primary font-medium">Creating employees…</p>
          {commitMutation.uploadProgress > 0 && commitMutation.uploadProgress < 100 && (
            <div className="w-full max-w-xs">
              <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF9D00] transition-all duration-300"
                  style={{ width: `${commitMutation.uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-text-secondary mt-1 text-center">{commitMutation.uploadProgress}%</p>
            </div>
          )}
          <p className="text-text-secondary text-xs">Do not close this page.</p>
        </div>
      )}

      {/* ── Step 'done': Commit result ───────────────────────────────────── */}
      {step === 'done' && commitResult?.committed && (
        <div className="bg-white border border-[#BBF7D0] rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#DCFCE7] rounded-xl flex items-center justify-center flex-shrink-0">
              <CheckCircle size={22} className="text-[#15803D]" />
            </div>
            <div>
              <h3 className="text-text-primary font-semibold text-base mb-1">Imported successfully</h3>
              <p className="text-text-secondary text-sm">
                <strong className="text-[#15803D]">{commitResult.successCount}</strong>{' '}
                {commitResult.successCount === 1 ? 'employee was' : 'employees were'} created in{' '}
                {selectedCompany?.name ?? tenantName}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <HrButton onClick={() => navigate('/hrms/employees')}>
              View employees <ChevronRight size={15} />
            </HrButton>
            <button
              onClick={reset}
              className="px-4 py-2 text-[#C16E00] hover:text-[#FF9D00] text-sm font-medium transition-colors"
            >
              Import more
            </button>
          </div>
        </div>
      )}

      {step === 'done' && commitResult && !commitResult.committed && (
        <div className="bg-white border border-[#FDE68A] rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#FEF3C7] rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle size={22} className="text-[#B45309]" />
            </div>
            <div>
              <h3 className="text-text-primary font-semibold text-base mb-1">Import blocked by validation errors</h3>
              <p className="text-text-secondary text-sm">
                The commit was rejected because {commitResult.errorCount}{' '}
                {commitResult.errorCount === 1 ? 'error was' : 'errors were'} found during the write phase.
                No employees were created. This can happen if an email was registered by another user between
                your validate and commit steps.
              </p>
            </div>
          </div>
          {commitResult.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-text-secondary hover:text-text-primary select-none">
                View {commitResult.errors.length} error{commitResult.errors.length !== 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 space-y-1">
                {commitResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="hr-mono text-xs text-[#B91C1C] bg-[#FEE2E2] px-3 py-1.5 rounded-lg">{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex items-center gap-3">
            <HrButton variant="ghost" onClick={() => setStep(2)}>
              Back to validate
            </HrButton>
          </div>
        </div>
      )}

      {/* Network / 5xx error during commit */}
      {step === 'done' && commitMutation.isError && (
        <EmptyState
          icon={XCircle}
          title="Import failed"
          description={
            `${(commitMutation.error as Error)?.message ?? 'An unknown error occurred.'} ` +
            'Import status is unclear — check the employees list to confirm what was created.'
          }
          action={{ label: 'Try again', onClick: handleCommit }}
        />
      )}

      {/* Skeletons shown while data is loading on initial mount */}
      {step === 2 && !file && companies.length === 0 && (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}
    </div>
  )
}
