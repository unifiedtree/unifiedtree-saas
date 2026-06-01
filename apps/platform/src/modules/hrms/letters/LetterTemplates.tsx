import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Edit3, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { useLetterTemplates, useDeleteTemplate } from './api/useLetters'
import type { LetterTemplateDto, LetterType } from './api/useLetters'
import { format } from 'date-fns'

const TYPE_STYLE: Record<LetterType, { label: string; color: string; bg: string }> = {
  OFFER:          { label: 'Offer',           color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
  APPOINTMENT:    { label: 'Appointment',     color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  RELIEVING:      { label: 'Relieving',       color: 'text-orange-400', bg: 'bg-orange-500/10'  },
  EXPERIENCE:     { label: 'Experience',      color: 'text-purple-400', bg: 'bg-purple-500/10'  },
  SALARY_REVISION:{ label: 'Salary Revision', color: 'text-yellow-400', bg: 'bg-yellow-500/10'  },
  CUSTOM:         { label: 'Custom',          color: 'text-[#64748B]',  bg: 'bg-[#F1F5F9]/40'   },
}

function TypeBadge({ type }: { type: LetterType }) {
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.CUSTOM
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', style.color, style.bg)}>
      {style.label}
    </span>
  )
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
          className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {deleteMut.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2.5 py-1 rounded-lg bg-white text-[#64748B] hover:text-[#0F172A] text-xs font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
      className="p-1.5 rounded-lg text-[#64748B] hover:bg-red-500/10 hover:text-red-400 transition-colors"
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
    <div className="p-6 animate-fade-in space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Letter Templates</h1>
          <p className="mt-0.5 text-sm text-[#64748B]">
            Manage reusable letter templates with merge fields
          </p>
        </div>
        <Can code={P.HRMS_LETTERS_TEMPLATE_CREATE}>
          <button
            onClick={() => navigate('/hrms/letters/templates/new')}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
          >
            <Plus size={14} />
            Create template
          </button>
        </Can>
      </div>

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
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-[#E2E8F0]/60 rounded-2xl">
          <FileText size={36} className="text-slate-700 mb-3" />
          <p className="text-[#64748B] text-sm font-medium">No letter templates yet</p>
          <p className="text-slate-600 text-xs mt-1">Create your first template to start generating letters</p>
          <Can code={P.HRMS_LETTERS_TEMPLATE_CREATE}>
            <button
              onClick={() => navigate('/hrms/letters/templates/new')}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
            >
              <Plus size={14} />
              Create template
            </button>
          </Can>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Type</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Last Updated</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#64748B] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {templates.map((tpl) => (
                  <tr
                    key={tpl.id}
                    onClick={() => navigate(`/hrms/letters/templates/${tpl.id}`)}
                    className="group cursor-pointer hover:bg-white transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#0F6E56]/10">
                          <FileText size={13} className="text-[#0F6E56]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0F172A] truncate">{tpl.name}</p>
                          {tpl.variantName && (
                            <p className="text-xs text-[#64748B] truncate">{tpl.variantName}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={tpl.type} />
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-[#64748B] text-xs">
                      {tpl.updatedAt ? format(new Date(tpl.updatedAt), 'd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          tpl.active
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-[#64748B] bg-[#F1F5F9]/40',
                        )}
                      >
                        {tpl.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Can code={P.HRMS_LETTERS_TEMPLATE_UPDATE}>
                          <button
                            onClick={() => navigate(`/hrms/letters/templates/${tpl.id}`)}
                            className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9]/60 hover:text-[#0F172A] transition-colors"
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
          </div>

          {hasPagination && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#64748B]">
                {totalElements} template{totalElements !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg border border-[#E2E8F0]/60 text-[#64748B] hover:text-[#0F172A] hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-[#64748B]">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg border border-[#E2E8F0]/60 text-[#64748B] hover:text-[#0F172A] hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
