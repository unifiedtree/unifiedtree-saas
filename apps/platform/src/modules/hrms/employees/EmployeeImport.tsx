// /hrms/employees/import — Import employees on the redesign kit (prototype PgEmpImport). Three
// steps, as before: download the template → upload & validate (into a chosen company) → confirm.
// Nothing is created until every row passes; the server checks the file again on commit.
//   - Template: .xlsx, or .csv (GET /v1/bulk-import/employees/template?format=csv). The column
//     chips come from GET …/columns (today's list when the server doesn't answer).
//   - Upload: .csv / .xlsx up to 10 MB; a file of 0 rows or more than 1,000 rows is refused.
//   - Results: rows, ready, problems; the problems in a filterable table (first 100). An email
//     someone in the workspace already has names that person on its row, and so does the same
//     email twice in the file; a phone number someone already has is a note that doesn't block.
//   - Leaving the page with a validated file asks first (beforeunload), as before.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Users } from 'lucide-react'
import { useAuthStore } from '@unifiedtree/sdk'
import {
  Button, Callout, ErrorState, PageFrame, PageHeader, ProgressBar, Section, StatCard, StatGrid, StepTrack, Table, type StepItem, type TableColumn,
} from '@/design/kit/display'
import { UploadDrop, UploadFile } from '@/design/kit/data'
import { Dropdown, FormField, Input, useToast } from '@/design/kit/overlays'
import { useCompanies } from '../api/useOrg'
import {
  countValidRows, parseErrors, useCommitBulkImport, useDownloadTemplate, useImportColumns, useValidateBulkImport, type BulkImportNote, type ParsedError,
} from '../api/useBulkImport'
import '../workforce/directory.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_ROWS = 1000
const SHOWN_ERRORS = 100
/** The template's columns when the server can't list them (today's template). */
const REQUIRED = ['first_name', 'last_name', 'email', 'employment_type', 'date_of_joining']
const OPTIONAL = ['phone', 'department', 'designation', 'job_title', 'gender', 'date_of_birth']

type WizardStep = 1 | 2 | 3 | 'done'
const STEPS = ['Download template', 'Upload & validate', 'Confirm import']
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function EmployeeImport() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: companies = [] } = useCompanies()
  const tenantName = useAuthStore((s) => s.tenant?.displayName ?? 'your organisation')
  const columnsQ = useImportColumns()
  const required = columnsQ.data?.required?.length ? columnsQ.data.required : REQUIRED
  const optional = columnsQ.data?.optional?.length ? columnsQ.data.optional : OPTIONAL

  const validateMutation = useValidateBulkImport()
  const commitMutation = useCommitBulkImport()
  const downloadMutation = useDownloadTemplate()

  const [step, setStep] = useState<WizardStep>(1)
  const [file, setFile] = useState<File | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [errorFilter, setErrorFilter] = useState('')

  // The first company until one is chosen.
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  // Leaving with a validated file about to be imported asks first.
  useEffect(() => {
    if (step !== 3 || !validateMutation.data) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step, validateMutation.data])

  const validationResult = validateMutation.data ?? null
  const validRows = validationResult ? countValidRows(validationResult) : 0
  const parsedErrors = useMemo(() => (validationResult ? parseErrors(validationResult.errors) : []), [validationResult])
  const filteredErrors = errorFilter
    ? parsedErrors.filter((e) => e.message.toLowerCase().includes(errorFilter.toLowerCase()) || String(e.rowNumber).includes(errorFilter))
    : parsedErrors
  const displayedErrors = filteredErrors.slice(0, SHOWN_ERRORS)
  const notes = (validationResult?.warnings ?? []).slice(0, SHOWN_ERRORS)
  const hiddenCount = filteredErrors.length - displayedErrors.length
  const commitResult = commitMutation.data ?? null
  const selectedCompany = companies.find((c) => c.id === companyId) ?? companies[0]
  const companyName = selectedCompany?.name ?? tenantName

  const pickFile = (f: File) => {
    setFile(f)
    validateMutation.reset()
    setErrorFilter('')
  }

  const handleValidate = async () => {
    if (!file || !companyId) return
    try {
      const result = await validateMutation.mutateAsync({ file, companyId })
      if (result.totalRows === 0) { toast.info('File appears to be empty. Check the template structure.'); return }
      if (result.totalRows > MAX_ROWS) toast.error(`File has ${result.totalRows} rows — maximum is 1,000 rows per import. Split the file and try again.`)
    } catch {
      // shown from validateMutation.error
    }
  }

  const handleCommit = async () => {
    if (!file || !companyId) return
    try { await commitMutation.mutateAsync({ file, companyId }) } catch { /* shown below */ }
    setStep('done')
  }

  const reset = () => {
    setFile(null)
    setErrorFilter('')
    validateMutation.reset()
    commitMutation.reset()
    setStep(1)
  }

  const download = (format: 'xlsx' | 'csv') => downloadMutation.mutate(
    { slug: useAuthStore.getState().tenant?.slug ?? 'tenant', format },
    { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not download the template. Please try again.') },
  )

  const at = step === 'done' ? 3 : step
  const steps: StepItem[] = STEPS.map((label, i) => ({
    key: label, label, state: step === 'done' || i + 1 < at ? 'done' : i + 1 === at ? 'current' : 'todo',
  }))

  const noteColumns: TableColumn<BulkImportNote>[] = [
    { key: 'row', header: 'Row', width: 90, render: (n) => <span className="wf-mono">{n.row || '?'}</span> },
    { key: 'msg', header: 'Note', render: (n) => <span>{n.column ? `${n.column}: ` : ''}{n.message}</span>, className: 'wf-wrap' },
  ]

  const errorColumns: TableColumn<ParsedError>[] = [
    { key: 'row', header: 'Row', width: 90, render: (e) => <span className="wf-mono">{e.rowNumber || '?'}</span> },
    { key: 'msg', header: 'Problem', render: (e) => <span className="wf-err">{e.message}</span>, className: 'wf-wrap' },
  ]

  return (
    <PageFrame label="Import employees">
      <PageHeader
        eyebrow={<span className="wf-crumbs"><button type="button" onClick={() => navigate('/hrms/employees')}>Workforce directory</button><span aria-hidden="true">/</span>Import</span>}
        title="Import employees"
        sub="Add many people at once from a spreadsheet. Nothing is created until every row passes."
        actions={<Button size={40} icon="chevronLeft" onClick={() => navigate('/hrms/employees')}>Back to employees</Button>} />
      <div className="wf-import">
        <StepTrack steps={steps} label="Import steps" />

        {step === 1 && (
          <>
            <div className="wf-import__grid">
              <Section title="Download the template" sub="Fill one row per person. Keep the column names as they are.">
                <div className="wf-row">
                  <Button variant="primary" size={40} icon="download" loading={downloadMutation.isPending} onClick={() => download('xlsx')}>
                    {downloadMutation.isPending ? 'Downloading…' : 'Download template'}
                  </Button>
                  <Button size={40} disabled={downloadMutation.isPending} onClick={() => download('csv')} aria-label="Download the template as .csv">.csv</Button>
                </div>
                <ul className="wf-notes">
                  <li>employment_type values: FULL_TIME, PART_TIME, CONTRACT, INTERN, CONSULTANT</li>
                  <li>date_of_joining format: yyyy-MM-dd (e.g. 2025-01-15)</li>
                  <li>Max 1,000 rows per import · Max file size: 10 MB</li>
                  <li>Accepted formats: .csv, .xlsx</li>
                </ul>
              </Section>
              <Section title="Columns" sub="The file’s first row names these columns.">
                <p className="wf-eyebrow wf-eyebrow--brand">Required columns</p>
                <div className="wf-cols">{required.map((c) => <code key={c}>{c}</code>)}</div>
                <p className="wf-eyebrow" style={{ marginTop: 14 }}>Optional columns</p>
                <div className="wf-cols wf-cols--opt">{optional.map((c) => <code key={c}>{c}</code>)}</div>
              </Section>
            </div>
            <div className="wf-row wf-row--end">
              <Button variant="primary" size={40} trailingIcon="arrowRight" onClick={() => setStep(2)}>I have a file ready</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="Upload & validate" sub="The file is checked first; nothing is saved at this step.">
              <div className="wf-form">
                {companies.length > 1 && (
                  <FormField label="Import into company">
                    <Dropdown label="Import into company" options={companies.map((c) => ({ value: c.id, label: c.name }))} value={companyId}
                      disabled={validateMutation.isPending} onChange={(x) => { setCompanyId(x); validateMutation.reset() }} />
                  </FormField>
                )}
                {file ? (
                  <UploadFile name={file.name} size={file.size}
                    progress={validateMutation.isPending ? validateMutation.uploadProgress : null}
                    onRemove={validateMutation.isPending ? undefined : () => { setFile(null); validateMutation.reset() }} removeLabel="Choose another file" />
                ) : (
                  <UploadDrop variant="zone" accept=".csv,.xlsx" maxSize={MAX_FILE_SIZE} disabled={validateMutation.isPending}
                    hint="Accepts .csv or .xlsx · Max 10 MB" ariaLabel="Choose the employee file"
                    onFiles={(fs) => fs[0] && pickFile(fs[0])} onReject={(r) => r[0] && toast.error(r[0].message)} />
                )}
                {file && !validateMutation.isPending && !validateMutation.data && (
                  <div className="wf-row"><Button variant="primary" size={40} icon="check" disabled={!companyId} onClick={handleValidate}>Validate file</Button></div>
                )}
                {validateMutation.isPending && <p className="wf-muted" role="status">Validating {file?.name}…</p>}
                {validateMutation.isError && (
                  <Callout tone="danger" icon="alertTriangle"><b>Validation request failed</b> — {(validateMutation.error as Error)?.message}</Callout>
                )}
              </div>
            </Section>

            {validationResult && !validateMutation.isPending && (
              <>
                <StatGrid min={200} label="Validation result">
                  <StatCard variant="stat" index={0} icon="users" tone="gray" label="Rows in the file" value={validationResult.totalRows} note="Employees to add" />
                  <StatCard variant="stat" index={1} icon="checkCircle" tone="brand" label="Ready" value={validRows} note="Passed every check" />
                  <StatCard variant="stat" index={2} icon={validationResult.errorCount > 0 ? 'circleX' : 'checkCircle'} tone={validationResult.errorCount > 0 ? 'red' : 'brand'}
                    label="Problems" value={validationResult.errorCount} note={validationResult.errorCount > 0 ? 'Fix them and upload again' : 'None'} />
                </StatGrid>

                {validationResult.errorCount > 0 && (
                  <Section title={plural(parsedErrors.length, 'validation error', 'validation errors')} body="flush"
                    actions={<Input size="md" leading="search" placeholder="Filter errors…" aria-label="Filter errors" value={errorFilter} onChange={(e) => setErrorFilter(e.target.value)} />}
                    footer={hiddenCount > 0 ? <p className="wf-muted" style={{ margin: 0, textAlign: 'center' }}>… and {plural(hiddenCount, 'more error', 'more errors')} not shown. Fix the file and re-validate to see all.</p> : undefined}>
                    <Table<ParsedError> label="Validation errors" columns={errorColumns} rows={displayedErrors} rowKey={(e) => e.id} minWidth={420}
                      className="wf-errors" stickyHeader empty="No errors match the filter" />
                  </Section>
                )}

                {notes.length > 0 && (
                  <Section title={plural(validationResult.warnings?.length ?? 0, 'thing worth a look', 'things worth a look')} sub="These don't stop the import." body="flush">
                    <Table<BulkImportNote> label="Notes" columns={noteColumns} rows={notes} rowKey={(n) => `${n.row}_${n.column}_${n.message}`} minWidth={420}
                      className="wf-errors" />
                  </Section>
                )}

                <div className="wf-row">
                  <Button size={40} variant="ghost" onClick={reset}>Upload a different file</Button>
                  {validationResult.errorCount === 0 && validRows > 0 && (
                    <Button variant="primary" size={40} trailingIcon="arrowRight" onClick={() => setStep(3)}>
                      Continue with {validRows} valid {validRows === 1 ? 'row' : 'rows'}
                    </Button>
                  )}
                  {validationResult.errorCount > 0 && (
                    <span className="wf-muted">
                      Fix {plural(validationResult.errorCount, 'error', 'errors')} above and re-upload — every row must be valid before any are created.
                    </span>
                  )}
                  {validationResult.errorCount === 0 && validRows === 0 && <span className="wf-muted">File is empty — add some rows and re-upload.</span>}
                </div>
              </>
            )}
          </>
        )}

        {step === 3 && !commitMutation.isPending && !commitMutation.isError && !commitMutation.isSuccess && (
          <Section title="Confirm import">
            <div className="wf-form">
              <p className="wf-lead">
                You are about to create <b>{validRows}</b> new {validRows === 1 ? 'employee' : 'employees'} in <b>{companyName}</b>. This can’t be undone, but each person can be removed afterwards.
              </p>
              <Callout tone="info" icon={<Users size={16} aria-hidden="true" />}>{plural(validRows, 'row', 'rows')} from {file?.name} will be created.</Callout>
              <div className="wf-row">
                <Button size={40} icon="chevronLeft" onClick={() => setStep(2)}>Back</Button>
                <Button variant="primary" size={40} onClick={handleCommit}>Confirm — create {validRows} {validRows === 1 ? 'employee' : 'employees'}</Button>
              </div>
            </div>
          </Section>
        )}

        {step === 3 && commitMutation.isPending && (
          <Section title="Creating employees…">
            <div className="wf-form" role="status">
              {commitMutation.uploadProgress > 0 && commitMutation.uploadProgress < 100 && (
                <ProgressBar className="wf-progress" value={commitMutation.uploadProgress} label="Upload progress" valueText={`${commitMutation.uploadProgress}%`} />
              )}
              <p className="wf-muted" style={{ margin: 0 }}>Do not close this page.</p>
            </div>
          </Section>
        )}

        {step === 'done' && commitResult?.committed && (
          <Section title="Imported successfully">
            <div className="wf-form">
              <div className="wf-done">
                <span className="wf-done__icon wf-done__icon--ok" aria-hidden="true"><CheckCircle2 size={22} /></span>
                <p><b>{commitResult.successCount}</b> {commitResult.successCount === 1 ? 'employee was' : 'employees were'} created in {companyName}.</p>
              </div>
              <div className="wf-row">
                <Button variant="primary" size={40} trailingIcon="arrowRight" onClick={() => navigate('/hrms/employees')}>View employees</Button>
                <Button size={40} variant="ghost" onClick={reset}>Import more</Button>
              </div>
            </div>
          </Section>
        )}

        {step === 'done' && commitResult && !commitResult.committed && (
          <Section title="Import blocked by validation errors">
            <div className="wf-form">
              <div className="wf-done">
                <span className="wf-done__icon wf-done__icon--warn" aria-hidden="true"><CircleAlert size={22} /></span>
                <p>
                  The commit was rejected because {plural(commitResult.errorCount, 'error was', 'errors were')} found during the write phase.
                  No employees were created. This can happen if an email was registered by another user between your validate and commit steps.
                </p>
              </div>
              {commitResult.errors.length > 0 && (
                <details>
                  <summary className="wf-link" style={{ textDecoration: 'none' }}>View {plural(commitResult.errors.length, 'error', 'errors')}</summary>
                  <ul className="wf-notes">{commitResult.errors.slice(0, 20).map((e, i) => <li key={i} className="wf-err">{e}</li>)}</ul>
                </details>
              )}
              <div className="wf-row"><Button size={40} icon="chevronLeft" onClick={() => setStep(2)}>Back to validate</Button></div>
            </div>
          </Section>
        )}

        {step === 'done' && commitMutation.isError && (
          <ErrorState title="The import didn’t finish"
            message={`${(commitMutation.error as Error)?.message ?? 'Something went wrong.'} Trying again is safe: the file is checked again first, and anyone whose email already exists is reported instead of being added twice.`}
            onRetry={handleCommit} />
        )}
      </div>
    </PageFrame>
  )
}
