import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, FileText, Download, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import {
  useGeneratedLetters,
  useMyLetters,
  useLetterTemplates,
  useGenerateLetter,
  downloadLetterPdf,
} from './api/useLetters'
import type { GeneratedLetterDto, LetterType, LetterStatus } from './api/useLetters'
import { useCompanies } from '../api/useOrg'
import { useEmployeeDirectory } from '../api/useWorkforce'

const TYPE_TONE: Record<LetterType, PillTone> = {
  OFFER: 'info', APPOINTMENT: 'ok', RELIEVING: 'orange', EXPERIENCE: 'purple', SALARY_REVISION: 'green', CUSTOM: 'gray',
}
const TYPE_LABEL: Record<LetterType, string> = {
  OFFER: 'Offer', APPOINTMENT: 'Appointment', RELIEVING: 'Relieving', EXPERIENCE: 'Experience', SALARY_REVISION: 'Salary Revision', CUSTOM: 'Custom',
}
const STATUS_TONE: Record<LetterStatus, PillTone> = {
  GENERATED: 'gray', SENT: 'info', VIEWED: 'green', SIGNED: 'ok', VOID: 'red',
}
const STATUS_LABEL: Record<LetterStatus, string> = {
  GENERATED: 'Generated', SENT: 'Sent', VIEWED: 'Viewed', SIGNED: 'Signed', VOID: 'Void',
}

function GenerateLetterModal({
  onClose,
  initialEmployeeId = '',
}: {
  onClose: () => void
  initialEmployeeId?: string
}) {
  const navigate = useNavigate()
  const generate = useGenerateLetter()
  const { data: templatesPage } = useLetterTemplates()
  const templates = templatesPage?.content ?? []
  const activeTemplates = templates.filter((t) => t.active)

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: directory } = useEmployeeDirectory({ companyId, pageSize: 200 })
  const employees = directory?.content ?? []

  const [templateId, setTemplateId] = useState('')
  const [employeeId, setEmployeeId] = useState(initialEmployeeId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!templateId.trim() || !employeeId.trim()) return
    try {
      await generate.mutateAsync({ templateId: templateId.trim(), employeeId: employeeId.trim() })
      toast.success('Letter generated')
      onClose()
    } catch {
      toast.error('Failed to generate letter')
    }
  }

  const selectCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none'

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-border-default bg-white p-6 shadow-2xl">
          <h3 className="mb-4 font-semibold text-text-primary">Generate Letter</h3>
          {activeTemplates.length === 0 ? (
            <div className="space-y-4">
              <div className="py-6 text-center text-text-secondary">
                <FileText size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No active letter templates</p>
                <p className="mt-1 text-xs text-text-tertiary">Create a template before generating letters</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => navigate('/hrms/letters/templates/new')}
                  className="flex-1 rounded-xl bg-[#FF9D00] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#E08A00]">
                  Create template
                </button>
                <button type="button" onClick={onClose}
                  className="flex-1 rounded-xl border border-border-default py-2.5 text-sm text-text-secondary transition-colors hover:text-text-primary">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Template *</label>
                <select required value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectCls}>
                  <option value="">Select a template</option>
                  {activeTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({TYPE_LABEL[t.type] ?? t.type})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Employee *</label>
                <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={selectCls}>
                  <option value="">Select an employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {[emp.firstName, emp.lastName].filter(Boolean).join(' ')} ({emp.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={generate.isPending}
                  className="flex-1 rounded-xl bg-[#FF9D00] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#E08A00] disabled:opacity-50">
                  {generate.isPending ? 'Generating…' : 'Generate'}
                </button>
                <button type="button" onClick={onClose}
                  className="flex-1 rounded-xl border border-border-default py-2.5 text-sm text-text-secondary transition-colors hover:text-text-primary">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  )
}

export const GeneratedLetters: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const employeeIdParam = searchParams.get('employeeId') ?? ''
  const [page, setPage] = useState(0)
  const [generateOpen, setGenerateOpen] = useState(false)

  // Deep-link from EmployeeDetail: ?employeeId=<id> opens the modal pre-filled.
  useEffect(() => {
    if (employeeIdParam) setGenerateOpen(true)
  }, [employeeIdParam])

  const closeGenerate = () => {
    setGenerateOpen(false)
    if (employeeIdParam) {
      searchParams.delete('employeeId')
      setSearchParams(searchParams, { replace: true })
    }
  }

  // Admins read the whole tenant via /letters/generated (hrms.letters.read); an
  // EMPLOYEE (read.self only) must use /letters/my, or the admin endpoint 403s.
  const canReadAll = usePermission(P.HRMS_LETTERS_READ)
  const canReadSelf = usePermission(P.HRMS_LETTERS_READ_SELF)
  const canView = canReadAll || canReadSelf
  const adminQuery = useGeneratedLetters(page, { enabled: canReadAll })
  const myQuery = useMyLetters(page, { enabled: !canReadAll && canReadSelf })
  const { data, isLoading, error, refetch } = canReadAll ? adminQuery : myQuery
  const letters: GeneratedLetterDto[] = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Generated Letters"
        subtitle={`${total} letter${total !== 1 ? 's' : ''} total`}
        actions={
          <Can code={P.HRMS_LETTERS_GENERATE}>
            <HrButton onClick={() => setGenerateOpen(true)}><Plus size={15} /> Generate Letter</HrButton>
          </Can>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load letters"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : letters.length === 0 ? (
        <EmptyState variant="first-run" title="No letters generated yet" description="Use the Generate Letter button to create one." />
      ) : (
        <TableCard
          footer={total > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">Showing {page * 20 + 1}–{Math.min((page + 1) * 20, total)} of {total}</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronLeft size={15} /></button>
                <span className="px-2 text-xs text-text-secondary">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30"><ChevronRight size={15} /></button>
              </div>
            </div>
          ) : undefined}
        >
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="hidden sm:table-cell">Type</th>
                <th className="hidden md:table-cell">Subject</th>
                <th className="hidden lg:table-cell">Generated At</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((letter) => {
                const shortEmpId = letter.employeeId.slice(0, 8) + '…'
                const subject = letter.subject.length > 60 ? letter.subject.slice(0, 60) + '…' : letter.subject
                return (
                  <tr key={letter.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF4E1]">
                          <FileText size={13} className="text-[#FF9D00]" />
                        </div>
                        <span className="hr-mono" title={letter.employeeId}>{shortEmpId}</span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell"><HrStatusPill tone={TYPE_TONE[letter.type] ?? 'gray'}>{TYPE_LABEL[letter.type] ?? letter.type}</HrStatusPill></td>
                    <td className="hidden md:table-cell max-w-[240px] text-text-secondary"><span title={letter.subject}>{subject}</span></td>
                    <td className="hidden lg:table-cell whitespace-nowrap text-text-secondary">{format(new Date(letter.createdAt), 'd MMM yyyy, HH:mm')}</td>
                    <td><HrStatusPill tone={STATUS_TONE[letter.status] ?? 'gray'}>{STATUS_LABEL[letter.status] ?? letter.status}</HrStatusPill></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {canView && (
                          <button onClick={() => navigate(`/hrms/letters/generated/${letter.id}`)} title="View" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary">
                            <Eye size={14} />
                          </button>
                        )}
                        {letter.hasPdf && (
                          <button onClick={() => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`)} title="Download PDF" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary">
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {generateOpen && (
        <GenerateLetterModal onClose={closeGenerate} initialEmployeeId={employeeIdParam} />
      )}
    </div>
  )
}
