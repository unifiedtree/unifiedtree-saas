import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, FileText, Download, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
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

const TYPE_STYLE: Record<LetterType, { label: string; color: string; bg: string }> = {
  OFFER:          { label: 'Offer',          color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
  APPOINTMENT:    { label: 'Appointment',    color: 'text-[#0F6E56]',  bg: 'bg-[#0F6E56]/10'  },
  RELIEVING:      { label: 'Relieving',      color: 'text-orange-400',  bg: 'bg-orange-500/10'  },
  EXPERIENCE:     { label: 'Experience',     color: 'text-violet-400',  bg: 'bg-violet-500/10'  },
  SALARY_REVISION:{ label: 'Salary Revision',color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  CUSTOM:         { label: 'Custom',         color: 'text-[#64748B]',   bg: 'bg-[#F1F5F9]/40'   },
}

const STATUS_STYLE: Record<LetterStatus, { label: string; color: string; bg: string }> = {
  GENERATED: { label: 'Generated', color: 'text-[#64748B]',   bg: 'bg-[#F1F5F9]/40'   },
  SENT:      { label: 'Sent',      color: 'text-blue-400',    bg: 'bg-blue-500/10'    },
  VIEWED:    { label: 'Viewed',    color: 'text-green-400',   bg: 'bg-green-500/10'   },
  SIGNED:    { label: 'Signed',    color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  VOID:      { label: 'Void',      color: 'text-red-400',     bg: 'bg-red-500/10'     },
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

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-[#E2E8F0]/60 rounded-2xl p-6 shadow-2xl">
          <h3 className="text-[#0F172A] font-semibold mb-4">Generate Letter</h3>
          {activeTemplates.length === 0 ? (
            <div className="space-y-4">
              <div className="text-center py-6 text-[#64748B]">
                <FileText size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No active letter templates</p>
                <p className="text-xs mt-1 text-slate-600">Create a template before generating letters</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/hrms/letters/templates/new')}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] font-medium rounded-xl text-sm transition-colors"
                >
                  Create template
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] rounded-xl text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
                Template *
              </label>
              <select
                required
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select a template</option>
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({TYPE_STYLE[t.type]?.label ?? t.type})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
                Employee *
              </label>
              <select
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select an employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {[emp.firstName, emp.lastName].filter(Boolean).join(' ')} ({emp.employeeCode})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={generate.isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#0F172A] font-medium rounded-xl text-sm transition-colors"
              >
                {generate.isPending ? 'Generating…' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] rounded-xl text-sm transition-colors"
              >
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Generated Letters</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{total} letter{total !== 1 ? 's' : ''} total</p>
        </div>
        <Can code={P.HRMS_LETTERS_GENERATE}>
          <button
            onClick={() => setGenerateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
          >
            <Plus size={15} /> Generate Letter
          </button>
        </Can>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load letters"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Employee</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Type</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Subject</th>
                  <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Generated At</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {letters.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-[#64748B]">
                      <FileText size={32} className="mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No letters generated yet</p>
                      <p className="text-xs mt-1 text-slate-600">Use the Generate Letter button to create one</p>
                    </td>
                  </tr>
                ) : letters.map((letter) => {
                  const typeMeta  = TYPE_STYLE[letter.type]  ?? TYPE_STYLE.CUSTOM
                  const statusMeta = STATUS_STYLE[letter.status] ?? STATUS_STYLE.GENERATED
                  const shortEmpId = letter.employeeId.slice(0, 8) + '…'
                  const subject = letter.subject.length > 60
                    ? letter.subject.slice(0, 60) + '…'
                    : letter.subject

                  return (
                    <tr
                      key={letter.id}
                      className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText size={13} className="text-[#64748B]" />
                          </div>
                          <span className="text-[#0F172A] font-mono text-xs" title={letter.employeeId}>{shortEmpId}</span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3">
                        <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', typeMeta.bg, typeMeta.color)}>
                          {typeMeta.label}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-[#64748B] text-sm max-w-[240px]">
                        <span title={letter.subject}>{subject}</span>
                      </td>
                      <td className="hidden lg:table-cell px-4 py-3 text-[#64748B] text-xs whitespace-nowrap">
                        {format(new Date(letter.createdAt), 'd MMM yyyy, HH:mm')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', statusMeta.bg, statusMeta.color)}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canView && (
                            <button
                              onClick={() => navigate(`/hrms/letters/generated/${letter.id}`)}
                              title="View"
                              className="p-1.5 text-[#64748B] hover:text-[#0F172A] transition-colors rounded-lg hover:bg-white"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          {letter.hasPdf && (
                            <button
                              onClick={() => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`)}
                              title="Download PDF"
                              className="p-1.5 text-[#64748B] hover:text-[#0F172A] transition-colors rounded-lg hover:bg-white"
                            >
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
          </div>

          {!isLoading && total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E8F0]">
              <p className="text-xs text-[#64748B]">
                Showing {page * 20 + 1}–{Math.min((page + 1) * 20, total)} of {total}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="p-1.5 text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-[#64748B] px-2">{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {generateOpen && (
        <GenerateLetterModal onClose={closeGenerate} initialEmployeeId={employeeIdParam} />
      )}
    </div>
  )
}
