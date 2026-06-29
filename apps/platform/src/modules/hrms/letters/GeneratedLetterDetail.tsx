import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Send, XCircle, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Can, P } from '@unifiedtree/sdk'
import { CardSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
import {
  useGeneratedLetter,
  useSendLetter,
  useVoidLetter,
  useDeleteGeneratedLetter,
  downloadLetterPdf,
} from './api/useLetters'
import type { LetterType, LetterStatus } from './api/useLetters'

const TYPE_STYLE: Record<LetterType, { label: string; tone: PillTone }> = {
  OFFER:           { label: 'Offer',           tone: 'info' },
  APPOINTMENT:     { label: 'Appointment',     tone: 'teal' },
  RELIEVING:       { label: 'Relieving',       tone: 'orange' },
  EXPERIENCE:      { label: 'Experience',      tone: 'purple' },
  SALARY_REVISION: { label: 'Salary Revision', tone: 'green' },
  CUSTOM:          { label: 'Custom',          tone: 'gray' },
}

const STATUS_STYLE: Record<LetterStatus, { label: string; tone: PillTone }> = {
  GENERATED: { label: 'Generated', tone: 'gray' },
  SENT:      { label: 'Sent',      tone: 'info' },
  VIEWED:    { label: 'Viewed',    tone: 'green' },
  SIGNED:    { label: 'Signed',    tone: 'teal' },
  VOID:      { label: 'Void',      tone: 'red' },
}

const inputClass =
  'w-full bg-white border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-[#FF9D00] focus:ring-2 focus:ring-[#FF9D00]/20'

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
      <div className="mt-3 p-3 bg-[#DCFCE7] border border-[#BBF7D0] rounded-xl">
        <p className="text-sm text-[#15803D] font-medium">Letter sent successfully.</p>
        {toEmail && <p className="text-xs text-text-secondary mt-0.5">Sent to {toEmail}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="mt-3 space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          To Email
        </label>
        <input
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          placeholder="employee@example.com"
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          CC Email <span className="normal-case font-normal text-text-tertiary">(optional)</span>
        </label>
        <input
          type="email"
          value={ccEmail}
          onChange={(e) => setCcEmail(e.target.value)}
          placeholder="manager@example.com"
          className={inputClass}
        />
      </div>
      <HrButton type="submit" disabled={send.isPending}>
        <Send size={13} />
        {send.isPending ? 'Sending…' : 'Send Letter'}
      </HrButton>
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
      <div className="mt-3 p-3 bg-[#FEE2E2] border border-[#FECACA] rounded-xl">
        <p className="text-sm text-[#B91C1C] font-medium">Letter has been voided.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleVoid} className="mt-3 space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Reason *
        </label>
        <textarea
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this letter is being voided…"
          className={clsx(inputClass, 'resize-none')}
        />
      </div>
      <HrButton type="submit" variant="danger" disabled={voidMut.isPending || !reason.trim()}>
        <XCircle size={13} />
        {voidMut.isPending ? 'Voiding…' : 'Confirm Void'}
      </HrButton>
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
    <div className="mx-auto max-w-6xl p-6 sm:p-8 animate-fade-in space-y-6">
      <button
        onClick={() => navigate('/hrms/letters/generated')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={16} />
        Generated Letters
      </button>

      <HrPageHeader
        crumb="Recruitment & Onboarding"
        title={letter.subject}
        subtitle={
          <span className="font-mono" title={letter.employeeId}>
            Employee: {letter.employeeId}
          </span>
        }
        actions={
          <>
            <HrStatusPill tone={typeMeta.tone}>{typeMeta.label}</HrStatusPill>
            <HrStatusPill tone={statusMeta.tone}>{statusMeta.label}</HrStatusPill>
            {letter.hasPdf && (
              <HrButton
                variant="ghost"
                onClick={() => downloadLetterPdf(letter.id, `letter-${letter.type.toLowerCase()}-${letter.id.slice(0, 8)}.pdf`)}
              >
                <Download size={14} /> Download PDF
              </HrButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white border border-border-default rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <p className="text-xs text-text-tertiary">Created At</p>
                <p className="text-sm text-text-primary">{format(new Date(letter.createdAt), 'd MMM yyyy, HH:mm')}</p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Generated By</p>
                <p className="text-sm text-text-primary hr-mono text-xs" title={letter.generatedBy}>
                  {letter.generatedBy.slice(0, 8)}…
                </p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Template ID</p>
                <p className="text-sm text-text-primary hr-mono text-xs" title={letter.templateId}>
                  {letter.templateId.slice(0, 8)}…
                </p>
              </div>
              {letter.pdfSizeBytes != null && (
                <div>
                  <p className="text-xs text-text-tertiary">PDF Size</p>
                  <p className="text-sm text-text-primary">
                    {(letter.pdfSizeBytes / 1024).toFixed(1)} KB
                  </p>
                </div>
              )}
            </div>
          </div>

          {contextEntries.length > 0 && (
            <div className="bg-white border border-border-default rounded-2xl overflow-hidden shadow-sm">
              <button
                onClick={() => setContextOpen((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-bg-base transition-colors"
              >
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Generation Context ({contextEntries.length})
                </span>
                {contextOpen ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
              </button>
              {contextOpen && (
                <div className="border-t border-border-default overflow-x-auto">
                  <table className="hr-table w-full">
                    <thead>
                      <tr>
                        <th className="w-1/3">Key</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contextEntries.map(([key, value]) => (
                        <tr key={key}>
                          <td className="hr-mono text-xs text-text-secondary whitespace-nowrap">{key}</td>
                          <td className="text-sm text-text-primary break-all">{value}</td>
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
          <div className="bg-white border border-border-default rounded-2xl p-5 space-y-4 shadow-sm">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Actions</h2>

            <Can code={P.HRMS_LETTERS_SEND}>
              <div className="border-b border-border-default pb-4">
                <button
                  onClick={() => { setSendOpen((v) => !v); setVoidOpen(false) }}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full justify-center',
                    sendOpen
                      ? 'bg-[#FF9D00] hover:bg-[#E08A00] text-white'
                      : 'border border-border-default bg-white hover:bg-bg-base text-text-primary',
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
                      ? 'border border-border-default bg-bg-base text-text-tertiary cursor-not-allowed'
                      : voidOpen
                        ? 'bg-[#EF4444] hover:bg-[#DC2626] text-white'
                        : 'border border-border-default bg-white hover:bg-bg-base text-text-primary',
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
              <div className="border-t border-border-default pt-4">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full justify-center bg-white hover:bg-red-50 text-[#B91C1C] border border-[#FECACA]"
                  >
                    <Trash2 size={13} /> Delete Letter
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[#B91C1C] text-center font-medium">Permanently delete this letter?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium border border-border-default bg-white text-text-secondary hover:bg-bg-base"
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
                        className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-[#EF4444] text-white hover:bg-[#DC2626] disabled:opacity-50"
                      >
                        {deleteMut.isPending ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Can>
          </div>

          <div className="bg-white border border-border-default rounded-2xl p-5 space-y-3 shadow-sm">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Status History</h2>

            {letter.sentAt ? (
              <div className="space-y-0.5">
                <p className="text-xs text-[#1D4ED8] font-medium">Sent</p>
                <p className="text-xs text-text-secondary">{format(new Date(letter.sentAt), 'd MMM yyyy, HH:mm')}</p>
                {letter.sentToEmail && (
                  <p className="text-xs text-text-secondary">{letter.sentToEmail}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary italic">Not yet sent</p>
            )}

            {letter.voidedAt && (
              <div className="space-y-0.5 pt-2 border-t border-border-default">
                <p className="text-xs text-[#B91C1C] font-medium">Voided</p>
                <p className="text-xs text-text-secondary">{format(new Date(letter.voidedAt), 'd MMM yyyy, HH:mm')}</p>
                {letter.voidedReason && (
                  <p className="text-xs text-text-secondary italic">"{letter.voidedReason}"</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
