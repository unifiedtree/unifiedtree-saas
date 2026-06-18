import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Send, XCircle, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  useGeneratedLetter,
  useSendLetter,
  useVoidLetter,
  useDeleteGeneratedLetter,
  downloadLetterPdf,
} from './api/useLetters'
import type { LetterType, LetterStatus } from './api/useLetters'

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

function SendForm({
  letterId,
  defaultEmail,
}: {
  letterId: string
  defaultEmail?: string
}) {
  const send = useSendLetter()
  const [toEmail, setToEmail] = useState(defaultEmail ?? '')
  const [ccEmail, setCcEmail] = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await send.mutateAsync({
        id: letterId,
        req: {
          toEmail: toEmail.trim() || undefined,
          ccEmail: ccEmail.trim() || undefined,
        },
      })
      toast.success('Letter sent')
      setSent(true)
    } catch {
      toast.error('Failed to send letter')
    }
  }

  if (sent) {
    return (
      <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
        <p className="text-sm text-emerald-400 font-medium">Letter sent successfully.</p>
        {toEmail && <p className="text-xs text-[#64748B] mt-0.5">Sent to {toEmail}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="mt-3 space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
          To Email
        </label>
        <input
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          placeholder="employee@example.com"
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
          CC Email <span className="normal-case font-normal text-slate-600">(optional)</span>
        </label>
        <input
          type="email"
          value={ccEmail}
          onChange={(e) => setCcEmail(e.target.value)}
          placeholder="manager@example.com"
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>
      <button
        type="submit"
        disabled={send.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
      >
        <Send size={13} />
        {send.isPending ? 'Sending…' : 'Send Letter'}
      </button>
    </form>
  )
}

function VoidForm({ letterId }: { letterId: string }) {
  const voidMut = useVoidLetter()
  const [reason, setReason] = useState('')
  const [voided, setVoided] = useState(false)

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return
    try {
      await voidMut.mutateAsync({ id: letterId, reason: reason.trim() })
      toast.success('Letter voided')
      setVoided(true)
    } catch {
      toast.error('Failed to void letter')
    }
  }

  if (voided) {
    return (
      <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
        <p className="text-sm text-red-400 font-medium">Letter has been voided.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleVoid} className="mt-3 space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
          Reason *
        </label>
        <textarea
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this letter is being voided…"
          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
        />
      </div>
      <button
        type="submit"
        disabled={voidMut.isPending || !reason.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-[#0F172A] text-sm font-medium rounded-xl transition-colors"
      >
        <XCircle size={13} />
        {voidMut.isPending ? 'Voiding…' : 'Confirm Void'}
      </button>
    </form>
  )
}

export const GeneratedLetterDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: letter, isLoading, error, refetch } = useGeneratedLetter(id)

  const [sendOpen, setSendOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const deleteMut = useDeleteGeneratedLetter()

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <CardSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          variant="error"
          title="Failed to load letter"
          description={(error as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
          secondaryAction={{ label: 'Back', onClick: () => navigate('/hrms/letters/generated') }}
        />
      </div>
    )
  }

  if (!letter) {
    return (
      <div className="p-6">
        <EmptyState
          variant="filtered"
          title="Letter not found"
          primaryAction={{ label: 'Back to letters', onClick: () => navigate('/hrms/letters/generated') }}
        />
      </div>
    )
  }

  const typeMeta   = TYPE_STYLE[letter.type]   ?? TYPE_STYLE.CUSTOM
  const statusMeta = STATUS_STYLE[letter.status] ?? STATUS_STYLE.GENERATED
  const isVoid     = letter.status === 'VOID'
  const contextEntries = letter.generationContext ? Object.entries(letter.generationContext) : []

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <button
        onClick={() => navigate('/hrms/letters/generated')}
        className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#0F172A] transition-colors"
      >
        <ArrowLeft size={16} />
        Generated Letters
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1 flex-1 min-w-0">
                <h1 className="text-lg font-bold text-[#0F172A] leading-snug">{letter.subject}</h1>
                <p className="text-xs text-[#64748B] font-mono" title={letter.employeeId}>
                  Employee: {letter.employeeId}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={clsx('px-2.5 py-1 text-xs font-medium rounded-full', typeMeta.bg, typeMeta.color)}>
                  {typeMeta.label}
                </span>
                <span className={clsx('px-2.5 py-1 text-xs font-medium rounded-full', statusMeta.bg, statusMeta.color)}>
                  {statusMeta.label}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pt-2 border-t border-[#E2E8F0]">
              <div>
                <p className="text-xs text-[#64748B]">Created At</p>
                <p className="text-sm text-slate-200">{format(new Date(letter.createdAt), 'd MMM yyyy, HH:mm')}</p>
              </div>
              <div>
                <p className="text-xs text-[#64748B]">Generated By</p>
                <p className="text-sm text-slate-200 font-mono text-xs" title={letter.generatedBy}>
                  {letter.generatedBy.slice(0, 8)}…
                </p>
              </div>
              <div>
                <p className="text-xs text-[#64748B]">Template ID</p>
                <p className="text-sm text-slate-200 font-mono text-xs" title={letter.templateId}>
                  {letter.templateId.slice(0, 8)}…
                </p>
              </div>
              {letter.pdfSizeBytes != null && (
                <div>
                  <p className="text-xs text-[#64748B]">PDF Size</p>
                  <p className="text-sm text-slate-200">
                    {(letter.pdfSizeBytes / 1024).toFixed(1)} KB
                  </p>
                </div>
              )}
            </div>

            {letter.hasPdf && (
              <div className="pt-3 border-t border-[#E2E8F0]">
                <button
                  onClick={() => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`)}
                  className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#F1F5F9] text-slate-200 text-sm font-medium rounded-xl transition-colors"
                >
                  <Download size={14} /> Download PDF
                </button>
              </div>
            )}
          </div>

          {contextEntries.length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
              <button
                onClick={() => setContextOpen((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-[#F8FAFC] transition-colors"
              >
                <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  Generation Context ({contextEntries.length})
                </span>
                {contextOpen ? <ChevronUp size={14} className="text-[#64748B]" /> : <ChevronDown size={14} className="text-[#64748B]" />}
              </button>
              {contextOpen && (
                <div className="border-t border-[#E2E8F0] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E2E8F0]/40">
                        <th className="px-5 py-2 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider w-1/3">Key</th>
                        <th className="px-5 py-2 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contextEntries.map(([key, value]) => (
                        <tr key={key} className="border-b border-[#E2E8F0]/30 last:border-0">
                          <td className="px-5 py-2 font-mono text-xs text-[#64748B] whitespace-nowrap">{key}</td>
                          <td className="px-5 py-2 text-sm text-[#334155] break-all">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <h2 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Actions</h2>

            <Can code={P.HRMS_LETTERS_SEND}>
              <div className="border-b border-[#E2E8F0] pb-4">
                <button
                  onClick={() => { setSendOpen((v) => !v); setVoidOpen(false) }}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full justify-center',
                    sendOpen
                      ? 'bg-indigo-600 text-[#0F172A]'
                      : 'bg-white hover:bg-[#F1F5F9] text-slate-200',
                  )}
                >
                  <Send size={13} /> Send Letter
                </button>
                {sendOpen && (
                  <SendForm letterId={letter.id} defaultEmail={letter.sentToEmail} />
                )}
              </div>
            </Can>

            <Can code={P.HRMS_LETTERS_VOID}>
              <div>
                <button
                  onClick={() => { setVoidOpen((v) => !v); setSendOpen(false) }}
                  disabled={isVoid}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full justify-center',
                    isVoid
                      ? 'bg-white text-slate-600 cursor-not-allowed'
                      : voidOpen
                        ? 'bg-red-600 text-[#0F172A]'
                        : 'bg-white hover:bg-[#F1F5F9] text-slate-200',
                  )}
                >
                  <XCircle size={13} />
                  {isVoid ? 'Already Voided' : 'Void Letter'}
                </button>
                {voidOpen && !isVoid && (
                  <VoidForm letterId={letter.id} />
                )}
              </div>
            </Can>

            <Can code={P.HRMS_LETTERS_DELETE}>
              <div className="border-t border-[#E2E8F0] pt-4">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full justify-center bg-white hover:bg-red-50 text-red-500 border border-red-200"
                  >
                    <Trash2 size={13} /> Delete Letter
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-red-500 text-center font-medium">Permanently delete this letter?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={deleteMut.isPending}
                        onClick={async () => {
                          try {
                            await deleteMut.mutateAsync(letter.id)
                            toast.success('Letter deleted')
                            navigate('/hrms/letters/generated')
                          } catch {
                            toast.error('Failed to delete letter')
                            setConfirmDelete(false)
                          }
                        }}
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        {deleteMut.isPending ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Can>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Status History</h2>

            {letter.sentAt ? (
              <div className="space-y-0.5">
                <p className="text-xs text-blue-400 font-medium">Sent</p>
                <p className="text-xs text-[#64748B]">{format(new Date(letter.sentAt), 'd MMM yyyy, HH:mm')}</p>
                {letter.sentToEmail && (
                  <p className="text-xs text-[#64748B]">{letter.sentToEmail}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">Not yet sent</p>
            )}

            {letter.voidedAt && (
              <div className="space-y-0.5 pt-2 border-t border-[#E2E8F0]">
                <p className="text-xs text-red-400 font-medium">Voided</p>
                <p className="text-xs text-[#64748B]">{format(new Date(letter.voidedAt), 'd MMM yyyy, HH:mm')}</p>
                {letter.voidedReason && (
                  <p className="text-xs text-[#64748B] italic">"{letter.voidedReason}"</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
