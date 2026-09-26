import React, { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { CheckCircle2, Upload, XCircle, Clock, FileText, Trash2 } from 'lucide-react'
import { HrButton } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import {
  useDocumentTypes,
  useMyDocuments,
  useSelfUploadDocument,
  useDeleteDocument,
  type DocumentType,
  type EmployeeDocumentV2,
} from '@/modules/hrms/api/useDocument'

/**
 * Employee-facing "My Documents" section on the Profile page.
 *
 * The signed-in user sees one card per document type the admin has configured
 * (Aadhaar, PAN, Photograph …). Each card shows either an upload button or
 * the current file with its verification status (Pending / Verified /
 * Rejected). Required types are pinned to the top so onboarding docs never
 * get missed.
 */
/** `bare`: drop the card's own heading and intro (a settings section supplies them). */
export const MyDocumentsCard: React.FC<{ bare?: boolean }> = ({ bare }) => {
  const types = useDocumentTypes()
  const mine = useMyDocuments(0, 200) // pull all, filter client-side per card

  const byType = useMemo(() => {
    const map = new Map<string, EmployeeDocumentV2[]>()
    ;(mine.data?.content as EmployeeDocumentV2[] | undefined)?.forEach((d) => {
      if (!d.documentTypeId) return
      const list = map.get(d.documentTypeId) || []
      list.push(d)
      map.set(d.documentTypeId, list)
    })
    return map
  }, [mine.data])

  const activeTypes = (types.data || []).filter((t) => t.active)
  const required = activeTypes.filter((t) => t.required)
  const optional = activeTypes.filter((t) => !t.required)

  return (
    <section>
      {!bare && <>
        <h3 className="mb-1 text-sm font-semibold text-text-primary">My documents</h3>
        <p className="mb-4 text-xs text-text-secondary">
          Upload your government IDs and other documents here. HR will verify each one.
        </p>
      </>}
      {types.isLoading || mine.isLoading ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : (types.isError || mine.isError) ? (
        <p className="text-xs text-red-600">Couldn't load documents.</p>
      ) : activeTypes.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          HR hasn't configured any document types yet. Ask them to add some in Settings.
        </p>
      ) : (
        <>
          {required.length > 0 && (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              Required
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {required.map((t) => (
              <TypeCard key={t.id} type={t} documents={byType.get(t.id) || []} />
            ))}
          </div>
          {optional.length > 0 && (
            <div className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              Optional
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {optional.map((t) => (
              <TypeCard key={t.id} type={t} documents={byType.get(t.id) || []} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

const TypeCard: React.FC<{ type: DocumentType; documents: EmployeeDocumentV2[] }> = ({ type, documents }) => {
  const latest = documents[0] // backend returns newest first
  const inputRef = useRef<HTMLInputElement>(null)
  const [issuedDate, setIssuedDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const upload = useSelfUploadDocument()
  const remove = useDeleteDocument()

  const acceptString = useMemo(() => {
    return type.allowedFormats
      .split(',')
      .map((f) => (f === 'pdf' ? 'application/pdf' : `image/${f}`))
      .join(',')
  }, [type.allowedFormats])

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const allowed = type.allowedFormats.toLowerCase().split(',')
    if (!allowed.includes(ext) && !(ext === 'jpg' && allowed.includes('jpeg'))) {
      toast.error(`Upload a ${type.allowedFormats.toUpperCase()} for ${type.displayName}`)
      return
    }
    if (file.size > type.maxSizeMb * 1024 * 1024) {
      toast.error(`File too large. Max ${type.maxSizeMb} MB.`)
      return
    }
    upload.mutate(
      {
        file,
        documentTypeId: type.id,
        title: type.displayName,
        issuedDate: issuedDate || undefined,
        expiryDate: expiryDate || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`${type.displayName} uploaded. Pending verification.`)
          setPickerOpen(false)
          setIssuedDate('')
          setExpiryDate('')
        },
        onError: (err) =>
          toast.error(`Upload failed`, { description: (err as Error).message }),
      },
    )
  }

  return (
    <div className="ut-card ut-card-sm p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText size={14} className="shrink-0 text-text-tertiary" />
            <p className="truncate text-sm font-medium text-text-primary">{type.displayName}</p>
            {latest && <StatusPill status={latest.verificationStatus || 'PENDING'} />}
          </div>
          {latest ? (
            <p className="mt-1 text-xs text-text-secondary">
              Uploaded {format(new Date(latest.createdAt), 'd MMM yyyy')}
              {latest.expiryDate && ` · expires ${format(new Date(latest.expiryDate), 'd MMM yyyy')}`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-text-tertiary">
              {type.allowedFormats.toUpperCase()} · max {type.maxSizeMb} MB
            </p>
          )}
          {latest?.verificationStatus === 'REJECTED' && latest.rejectionReason && (
            <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
              Rejected: {latest.rejectionReason}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {latest?.fileUrl && (
            <a
              href={latest.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-1 text-text-tertiary hover:bg-bg-subtle hover:text-text-primary"
              title="View"
            >
              View
            </a>
          )}
          {latest && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete your ${type.displayName}?`)) {
                  remove.mutate(latest.id, {
                    onSuccess: () => toast.success('Removed'),
                    onError: (err) => toast.error('Delete failed', { description: (err as Error).message }),
                  })
                }
              }}
              className="rounded-md p-1 text-text-tertiary hover:bg-red-50 hover:text-red-600"
              title="Delete"
              disabled={remove.isPending}
            >
              <Trash2 size={14} />
            </button>
          )}
          {(!latest || latest.verificationStatus === 'REJECTED') && (
            <button
              type="button"
              onClick={() => {
                if (type.expiryTracked) {
                  setPickerOpen((v) => !v)
                } else {
                  inputRef.current?.click()
                }
              }}
              className="rounded-md p-1 text-[#059669] hover:bg-[#059669]/10"
              title={latest ? 'Re-upload' : 'Upload'}
              disabled={upload.isPending}
            >
              <Upload size={14} />
            </button>
          )}
        </div>
      </div>
      {pickerOpen && type.expiryTracked && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border-subtle bg-bg-base p-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-text-tertiary">Issued</label>
            <DateField
              aria-label="Issued"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
              className="w-full rounded border border-border-default bg-white px-2 py-1 text-xs"
              size="sm"
              format="short"
              clearable
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-text-tertiary">Expires</label>
            <DateField
              aria-label="Expires"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full rounded border border-border-default bg-white px-2 py-1 text-xs"
              size="sm"
              format="short"
              clearable
              toYear={new Date().getFullYear() + 50}
            />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="col-span-2 rounded-md bg-[#059669] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#047857] disabled:opacity-50"
          >
            {upload.isPending ? 'Uploading…' : 'Choose file & upload'}
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={acceptString}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'VERIFIED')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 size={10} /> Verified
      </span>
    )
  if (status === 'REJECTED')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
        <XCircle size={10} /> Rejected
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      <Clock size={10} /> Pending
    </span>
  )
}

export default MyDocumentsCard
