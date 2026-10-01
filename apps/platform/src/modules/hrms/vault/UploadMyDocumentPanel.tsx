// Upload one of my documents (P-DOCS; EmpDocs "Add another document" and
// "Upload new copy"): the document type (its formats and size limit apply), the
// file, and the issue and expiry dates when the type tracks expiry. It goes to
// HR's review queue as "Waiting for HR" (POST /v1/document/upload/self).
import { useState } from 'react'
import { Callout } from '@/design/kit/display'
import { UploadDrop } from '@/design/kit/data'
import { DateInput, FieldGrid, PanelButton, Select, SidePanel, useToast } from '@/design/kit/overlays'
import { fileProblem, typeFormats, useDocumentTypes, useSelfUploadDocument } from '../api/useDocument'

/** Expiry pickers reach decades ahead (IDs and licences can run 20+ years). */
const EXPIRY_TO_YEAR = new Date().getFullYear() + 50

export function UploadMyDocumentPanel({ initialTypeId, initialFile, onClose }: { initialTypeId?: string; initialFile?: File; onClose: () => void }) {
  const toast = useToast()
  const types = useDocumentTypes()
  const upload = useSelfUploadDocument()
  const active = (types.data ?? []).filter((t) => t.active)
  const [typeId, setTypeId] = useState(initialTypeId ?? '')
  const [file, setFile] = useState<File | null>(initialFile ?? null)
  const [issued, setIssued] = useState('')
  const [expires, setExpires] = useState('')
  const [tried, setTried] = useState(false)
  const type = active.find((t) => t.id === typeId)
  const formats = typeFormats(type)
  const accept = formats.map((f) => `.${f}`).join(',')
  const problems = {
    type: !type ? 'Choose what the document is.' : null,
    file: !file ? 'Choose the file.' : type ? fileProblem(file, type) || null : null,
    dates: issued && expires && expires < issued ? 'The expiry date is before the issue date.' : null,
  }
  const blocked = problems.type || problems.file || problems.dates

  const submit = async () => {
    setTried(true)
    if (blocked || !type || !file) return
    try {
      await upload.mutateAsync({ file, documentTypeId: type.id, title: type.displayName, issuedDate: issued || undefined, expiryDate: expires || undefined })
      toast.success(`${type.displayName} uploaded. HR will check it.`)
      onClose()
    } catch (e) {
      toast.error('Upload failed', { detail: (e as Error)?.message })
    }
  }

  return (
    <SidePanel open onClose={() => { if (!upload.isPending) onClose() }} busy={upload.isPending} closeLabel="Close panel"
      title="Upload a document" sub="It goes to HR to check. You’ll see it here as waiting until they do."
      footer={<>
        <PanelButton size="lg" onClick={onClose} disabled={upload.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={upload.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={submit}>Upload</PanelButton>
      </>}>
      <div className="lt-stack">
        {types.isError && <Callout tone="danger">Couldn’t load the document types.</Callout>}
        <FieldGrid columns={1}>
          <Select label="Document type" full value={typeId} onChange={(e) => setTypeId(e.target.value)} error={tried ? problems.type ?? undefined : undefined}
            options={[{ value: '', label: types.isLoading ? 'Loading…' : active.length ? 'Choose a type' : 'No document types yet' },
              ...active.map((t) => ({ value: t.id, label: `${t.displayName}${t.required ? ' (required)' : ''}` }))]}
            hint={type ? `${formats.join(', ').toUpperCase()} · up to ${type.maxSizeMb} MB` : undefined} />
        </FieldGrid>
        <UploadDrop variant="box" accept={accept} maxSize={(type?.maxSizeMb ?? 10) * 1024 * 1024}
          title={file ? `${file.name} · change the file` : 'Drop the file here, or click to choose it'}
          error={tried && problems.file ? problems.file : undefined}
          onFiles={(files) => setFile(files[0] ?? null)} onReject={(r) => toast.error(r[0]?.message ?? 'That file can’t be used')} ariaLabel="Choose the file" />
        <FieldGrid columns={2}>
          <DateInput label="Issued" value={issued} onChange={(e) => setIssued(e.target.value)} clearable hint="Optional" />
          {(type?.expiryTracked ?? true) && (
            <DateInput label="Expires" value={expires} min={issued || undefined} toYear={EXPIRY_TO_YEAR} onChange={(e) => setExpires(e.target.value)}
              clearable hint="Optional" error={tried ? problems.dates ?? undefined : undefined} />
          )}
        </FieldGrid>
      </div>
    </SidePanel>
  )
}
