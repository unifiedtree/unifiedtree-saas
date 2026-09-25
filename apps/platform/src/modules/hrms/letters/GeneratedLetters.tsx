import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, FileText, Download, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { ModulePage, State, stamp } from '@/design/module/ModuleKit'
import {
  useGeneratedLetters,
  useMyLetters,
  downloadLetterPdf,
} from './api/useLetters'
import type { GeneratedLetterDto, LetterType, LetterStatus } from './api/useLetters'
import { GenerateLetterDrawer } from './GenerateLetterDrawer'

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
    <ModulePage crumb="Letters" title={canReadAll ? 'Generated letters' : 'My letters'}
      subtitle={data ? `${total} ${total === 1 ? 'letter' : 'letters'}${canReadAll ? '' : ' issued to you'}` : undefined}
      actions={<Can code={P.HRMS_LETTERS_GENERATE}><HrButton onClick={() => setGenerateOpen(true)}><Plus size={15} /> Generate letter</HrButton></Can>}>
      {isLoading ? (
        <State kind="loading" height={220} />
      ) : error ? (
        <State kind="error" title="Couldn’t load letters" description={(error as Error).message} onRetry={() => refetch()} />
      ) : letters.length === 0 ? (
        <State kind="empty" icon="fileText" title={canReadAll ? 'No letters generated yet' : 'No letters yet'} description={canReadAll ? 'Use “Generate letter” to create one from a template.' : 'Letters HR issues to you (offer, appointment, experience…) appear here.'} />
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
                const subject = letter.subject.length > 60 ? letter.subject.slice(0, 60) + '…' : letter.subject
                return (
                  <tr key={letter.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5]">
                          <FileText size={13} className="text-[#059669]" />
                        </div>
                        <div><p className="font-semibold text-text-primary">{letter.employeeName || letter.generationContext?.['employee.fullName'] || 'Employee record unavailable'}</p>{(letter.employeeCode || letter.generationContext?.['employee.code']) && <p className="mt-0.5 text-xs text-text-secondary">{letter.employeeCode || letter.generationContext?.['employee.code']}</p>}</div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell"><HrStatusPill tone={TYPE_TONE[letter.type] ?? 'gray'}>{TYPE_LABEL[letter.type] ?? letter.type}</HrStatusPill></td>
                    <td className="hidden md:table-cell max-w-[240px] text-text-secondary"><span title={letter.subject}>{subject}</span></td>
                    <td className="hidden lg:table-cell whitespace-nowrap text-text-secondary">{stamp(letter.createdAt)}</td>
                    <td><HrStatusPill tone={STATUS_TONE[letter.status] ?? 'gray'}>{STATUS_LABEL[letter.status] ?? letter.status}</HrStatusPill></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {canView && (
                          <button onClick={() => navigate(`/hrms/letters/generated/${letter.id}`)} title="View" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary">
                            <Eye size={14} />
                          </button>
                        )}
                        {letter.hasPdf && (
                          <button onClick={() => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`).catch(error => toast.error(error instanceof Error ? error.message : 'Unable to download PDF'))} title="Download PDF" className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary">
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
        <GenerateLetterDrawer onClose={closeGenerate} initialEmployeeId={employeeIdParam} />
      )}
    </ModulePage>
  )
}
