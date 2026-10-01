// My documents, as cards (P-DOCS; prototype EmpDocs `e-files`): the documents on
// the signed-in person's file (GET /v1/document/my), each with its state:
// verified, waiting for HR, rejected (with HR's reason, a gold ring and "Upload
// new copy"), or expired. Required document types still missing come next, then
// "Add another document". Uploads go to HR's review queue
// (POST /v1/document/upload/self, hrms.document.write.self; the types need
// hrms.document.type.read). The person may delete an upload HR hasn't accepted.
import { useMemo, useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Callout, EmptyState, ErrorState, SkeletonBlock } from '@/design/kit/display'
import { ActionCard, ActionCardGrid, UploadDrop } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { todayIso } from '@/design/module/ModuleKit'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import {
  useDeleteDocument, useMyDocuments, useMyMissingDocuments, type EmployeeDocumentV2,
} from '../api/useDocument'
import { documentCard, documentsBanner } from './vaultModel'
import { UploadMyDocumentPanel } from './UploadMyDocumentPanel'
import '../letters/components/letters.css'

export function MyDocuments() {
  const toast = useToast()
  const confirm = useConfirmDialog()
  const canUploadSelf = usePermission('hrms.document.write.self')
  const canReadTypes = usePermission('hrms.document.type.read')
  const canUpload = canUploadSelf && canReadTypes
  const mine = useMyDocuments(0, 200)
  const missing = useMyMissingDocuments(canReadTypes)
  const remove = useDeleteDocument()
  const [upload, setUpload] = useState<{ typeId?: string; file?: File } | null>(null)
  const today = todayIso()
  const docs = useMemo(() => (mine.data?.content ?? []) as EmployeeDocumentV2[], [mine.data])
  const needed = canReadTypes ? missing.data ?? [] : []
  const banner = documentsBanner(docs, needed)

  if (mine.isLoading) return <SkeletonBlock style={{ height: 200 }} label="Loading your documents" />
  if (mine.error) return <ErrorState title="Couldn’t load your documents" error={mine.error} onRetry={() => mine.refetch()} />

  const del = async (d: EmployeeDocumentV2) => {
    const ok = await confirm({ title: `Delete your ${d.title}?`, body: 'HR hasn’t accepted it, so nothing on your file changes.', confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    remove.mutate(d.id, { onSuccess: () => toast.success('Removed'), onError: (e) => toast.error('Delete failed', { detail: (e as Error)?.message }) })
  }

  return (
    <div className="lt-stack">
      {banner && <Callout tone="warning" icon="alert">{banner}</Callout>}
      {docs.length === 0 && needed.length === 0
        ? <EmptyState icon="file" title="Nothing on your file yet" hint="When HR adds a document to your file it appears here. Ask HR if you’re expecting something." />
        : (
          <ActionCardGrid label="Your documents">
            {docs.map((d, i) => {
              const c = documentCard(d, today)
              const typeId = d.documentTypeId ?? undefined
              return (
                <ActionCard key={d.id} index={i} icon="file" title={d.title} sub={c.sub} status={c.state} tone={c.tone}
                  primary={c.redo && canUpload && typeId ? { label: 'Upload new copy', onClick: () => setUpload({ typeId }), ariaLabel: `Upload a new copy of ${d.title}` } : undefined}
                  secondary={d.fileUrl ? { label: 'View', href: d.fileUrl, target: '_blank', ariaLabel: `View ${d.title}` }
                    : { label: 'Can’t open here', disabled: true, ariaLabel: `${d.title}: the file can’t be opened here (document storage isn’t set up)` }}
                  actions={canUploadSelf && (d.verificationStatus === 'PENDING' || d.verificationStatus === 'REJECTED')
                    ? <button type="button" className="lt-link lt-small" onClick={() => del(d)} aria-label={`Delete ${d.title}`}>Delete</button> : undefined} />
              )
            })}
            {needed.map((t, i) => (
              <ActionCard key={`need-${t.id}`} index={docs.length + i} icon="file" title={t.displayName}
                sub={`HR needs this · ${t.allowedFormats.split(',').map((f) => f.trim().toUpperCase()).join(', ')}, up to ${t.maxSizeMb} MB`} status="Not uploaded yet" tone="action"
                primary={canUpload ? { label: 'Upload', onClick: () => setUpload({ typeId: t.id }), ariaLabel: `Upload ${t.displayName}` } : undefined} />
            ))}
          </ActionCardGrid>
        )}
      {canUpload && (
        <UploadDrop variant="bar" className="lt-upload-bar" title="Add another document" hint={false}
          onFiles={(files) => setUpload({ file: files[0] })} ariaLabel="Add another document" />
      )}
      {upload && <UploadMyDocumentPanel initialTypeId={upload.typeId} initialFile={upload.file} onClose={() => setUpload(null)} />}
    </div>
  )
}
