import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Edit3, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useLetterTemplates, useDeleteTemplate } from './api/useLetters'
import type { LetterTemplateDto, LetterType } from './api/useLetters'

const TYPE_TONE: Record<LetterType, PillTone> = {
  OFFER: 'info', APPOINTMENT: 'ok', RELIEVING: 'orange', EXPERIENCE: 'purple', SALARY_REVISION: 'warn', CUSTOM: 'gray',
}
const TYPE_LABEL: Record<LetterType, string> = {
  OFFER: 'Offer', APPOINTMENT: 'Appointment', RELIEVING: 'Relieving', EXPERIENCE: 'Experience', SALARY_REVISION: 'Salary Revision', CUSTOM: 'Custom',
}

function DeleteCell({ id, name }: { id: string; name: string }) {
  const { toast } = useToast()
  const deleteMut = useDeleteTemplate()
  const [confirming, setConfirming] = useState(false)

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync(id)
      toast(`"${name}" deleted`, 'success')
    } catch {
      toast('Failed to delete template', 'error')
    } finally {
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleDelete}
          disabled={deleteMut.isPending}
          className="rounded-lg bg-[#FEE2E2] px-2.5 py-1 text-xs font-medium text-[#B91C1C] transition-colors hover:bg-[#FECACA] disabled:opacity-50"
        >
          {deleteMut.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-lg px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
      className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]"
      aria-label="Delete template"
    >
      <Trash2 size={14} />
    </button>
  )
}

export const LetterTemplates: React.FC = () => {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)

  const { data, isLoading, error, refetch } = useLetterTemplates(page)
  const templates: LetterTemplateDto[] = data?.content ?? []
  const totalPages = data?.totalPages ?? 1
  const totalElements = data?.totalElements ?? 0
  const hasPagination = totalElements > 20

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title="Letter Templates"
        subtitle="Manage reusable letter templates with merge fields"
        actions={
          <Can code={P.HRMS_LETTERS_TEMPLATE_CREATE}>
            <HrButton onClick={() => navigate('/hrms/letters/templates/new')}><Plus size={15} /> Create template</HrButton>
          </Can>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load templates"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-default py-20">
          <FileText size={36} className="mb-3 text-text-tertiary" />
          <p className="text-sm font-medium text-text-secondary">No letter templates yet</p>
          <p className="mt-1 text-xs text-text-tertiary">Create your first template to start generating letters</p>
          <Can code={P.HRMS_LETTERS_TEMPLATE_CREATE}>
            <HrButton className="mt-4" onClick={() => navigate('/hrms/letters/templates/new')}><Plus size={15} /> Create template</HrButton>
          </Can>
        </div>
      ) : (
        <>
          <TableCard>
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="hidden md:table-cell">Last Updated</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => (
                  <tr key={tpl.id} onClick={() => navigate(`/hrms/letters/templates/${tpl.id}`)} className="cursor-pointer">
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF4E1]">
                          <FileText size={13} className="text-[#FF9D00]" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">{tpl.name}</p>
                          {tpl.variantName && <p className="truncate text-xs text-text-tertiary">{tpl.variantName}</p>}
                        </div>
                      </div>
                    </td>
                    <td><HrStatusPill tone={TYPE_TONE[tpl.type] ?? 'gray'}>{TYPE_LABEL[tpl.type] ?? tpl.type}</HrStatusPill></td>
                    <td className="hidden md:table-cell text-text-secondary">{tpl.updatedAt ? format(new Date(tpl.updatedAt), 'd MMM yyyy') : '—'}</td>
                    <td><HrStatusPill tone={tpl.active ? 'ok' : 'gray'}>{tpl.active ? 'Active' : 'Inactive'}</HrStatusPill></td>
                    <td>
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Can code={P.HRMS_LETTERS_TEMPLATE_UPDATE}>
                          <button
                            onClick={() => navigate(`/hrms/letters/templates/${tpl.id}`)}
                            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary"
                            aria-label="Edit template"
                          >
                            <Edit3 size={14} />
                          </button>
                        </Can>
                        <Can code={P.HRMS_LETTERS_TEMPLATE_DELETE}>
                          <DeleteCell id={tpl.id} name={tpl.name} />
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>

          {hasPagination && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">{totalElements} template{totalElements !== 1 ? 's' : ''}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-text-secondary">{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
