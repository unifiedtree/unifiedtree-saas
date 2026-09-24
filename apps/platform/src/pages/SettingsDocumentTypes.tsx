import React, { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Power, PowerOff, Save, X } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton } from '@/shared/components/hr'
import {
  useDocumentTypes,
  useCreateDocumentType,
  useUpdateDocumentType,
  useDeactivateDocumentType,
  type DocumentType,
  type DocumentTypePayload,
} from '@/modules/hrms/api/useDocument'

/**
 * Settings > Document Types.
 *
 * Admin (or anyone with hrms.document.type.write) configures the catalog of
 * document types an employee sees on their Profile: display name, allowed
 * formats, max size, required Y/N, expiry-tracked Y/N, active Y/N. Changes
 * take effect immediately — every employee's "My documents" section refetches
 * on next open.
 */
/** `bare`: drop the intro card (a settings section supplies the intro). */
export const DocumentTypesTab: React.FC<{ bare?: boolean }> = ({ bare }) => {
  const canWrite = usePermission('hrms.document.type.write' as unknown as keyof typeof P)
  const types = useDocumentTypes(/* includeInactive */ true)
  const [editing, setEditing] = useState<Partial<DocumentType> | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-4">
      {!bare && <div className="ut-card ut-card-sm p-4">
        <p className="text-xs text-text-secondary">
          These are the documents an employee sees on their profile. Mark a type
          as Required to make it a mandatory upload for every employee. HR
          verifies each upload after it lands.
        </p>
      </div>}

      {canWrite && !adding && !editing && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-[#059669] px-3 py-1.5 text-sm font-medium text-[#059669] hover:bg-[#059669]/10"
        >
          <Plus size={14} /> Add document type
        </button>
      )}

      {(adding || editing) && (
        <TypeForm
          initial={editing || undefined}
          onCancel={() => {
            setAdding(false)
            setEditing(null)
          }}
          onDone={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}

      {types.isLoading ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : types.isError ? (
        <p className="text-xs text-red-600">Couldn't load document types.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-default bg-white">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Formats</th>
                <th className="px-3 py-2 font-semibold">Max size</th>
                <th className="px-3 py-2 font-semibold">Required</th>
                <th className="px-3 py-2 font-semibold">Expiry</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(types.data || []).map((t) => (
                <tr key={t.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-primary">{t.displayName}</div>
                    <div className="text-[11px] text-text-tertiary">{t.code}</div>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{t.allowedFormats.toUpperCase()}</td>
                  <td className="px-3 py-2 text-text-secondary">{t.maxSizeMb} MB</td>
                  <td className="px-3 py-2">{t.required ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{t.expiryTracked ? 'Tracked' : '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        t.active
                          ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
                          : 'rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-semibold text-text-tertiary'
                      }
                    >
                      {t.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          className="rounded-md p-1 text-text-tertiary hover:bg-bg-subtle hover:text-text-primary"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <ToggleActive type={t} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(types.data || []).length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-xs text-text-tertiary" colSpan={7}>
                    No document types yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const ToggleActive: React.FC<{ type: DocumentType }> = ({ type }) => {
  const deactivate = useDeactivateDocumentType()
  const update = useUpdateDocumentType()
  if (type.active) {
    return (
      <button
        type="button"
        onClick={() => {
          if (confirm(`Deactivate "${type.displayName}"? Employees will no longer see it.`)) {
            deactivate.mutate(type.id, {
              onSuccess: () => toast.success('Deactivated'),
              onError: (err) => toast.error('Could not deactivate', { description: (err as Error).message }),
            })
          }
        }}
        disabled={deactivate.isPending}
        className="rounded-md p-1 text-text-tertiary hover:bg-red-50 hover:text-red-600"
        title="Deactivate"
      >
        <PowerOff size={14} />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() =>
        update.mutate(
          {
            id: type.id,
            code: type.code,
            displayName: type.displayName,
            description: type.description || undefined,
            allowedFormats: type.allowedFormats,
            maxSizeMb: type.maxSizeMb,
            required: type.required,
            expiryTracked: type.expiryTracked,
            active: true,
            sortOrder: type.sortOrder,
          },
          {
            onSuccess: () => toast.success('Activated'),
            onError: (err) => toast.error('Could not activate', { description: (err as Error).message }),
          },
        )
      }
      disabled={update.isPending}
      className="rounded-md p-1 text-text-tertiary hover:bg-emerald-50 hover:text-emerald-600"
      title="Activate"
    >
      <Power size={14} />
    </button>
  )
}

const TypeForm: React.FC<{
  initial?: Partial<DocumentType>
  onCancel: () => void
  onDone: () => void
}> = ({ initial, onCancel, onDone }) => {
  const isEdit = !!initial?.id
  const [code, setCode] = useState(initial?.code || '')
  const [displayName, setDisplayName] = useState(initial?.displayName || '')
  const [allowedFormats, setAllowedFormats] = useState(initial?.allowedFormats || 'pdf,jpg,jpeg,png')
  const [maxSizeMb, setMaxSizeMb] = useState(initial?.maxSizeMb ?? 5)
  const [required, setRequired] = useState(initial?.required ?? false)
  const [expiryTracked, setExpiryTracked] = useState(initial?.expiryTracked ?? false)
  const [description, setDescription] = useState(initial?.description || '')

  const create = useCreateDocumentType()
  const update = useUpdateDocumentType()

  const submit = () => {
    const payload: DocumentTypePayload = {
      code: code.trim().toUpperCase(),
      displayName: displayName.trim(),
      description: description.trim() || undefined,
      allowedFormats: allowedFormats.trim().toLowerCase(),
      maxSizeMb,
      required,
      expiryTracked,
      active: true,
      sortOrder: initial?.sortOrder ?? 100,
    }
    if (!payload.code || !payload.displayName) {
      toast.error('Code and name are required.')
      return
    }
    if (!/^[A-Z0-9_]{2,50}$/.test(payload.code)) {
      toast.error('Code must be UPPERCASE letters, digits or underscores.')
      return
    }
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'Document type updated' : 'Document type created')
        onDone()
      },
      onError: (err: unknown) =>
        toast.error(isEdit ? 'Update failed' : 'Create failed', { description: (err as Error).message }),
    }
    if (isEdit && initial?.id) update.mutate({ id: initial.id, ...payload }, opts)
    else create.mutate(payload, opts)
  }

  return (
    <div className="ut-card ut-card-sm space-y-3 border border-[#059669]/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="AADHAAR"
            disabled={isEdit}
            className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none disabled:bg-bg-subtle disabled:text-text-tertiary focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
          />
        </Field>
        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Aadhaar Card"
            className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
          />
        </Field>
        <Field label="Allowed formats" hint="Comma-separated, e.g. pdf,jpg,png">
          <input
            type="text"
            value={allowedFormats}
            onChange={(e) => setAllowedFormats(e.target.value.toLowerCase())}
            className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
          />
        </Field>
        <Field label="Max size (MB)">
          <input
            type="number"
            value={maxSizeMb}
            onChange={(e) => setMaxSizeMb(Number(e.target.value))}
            min={1}
            max={50}
            className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
          />
        </Field>
      </div>

      <Field label="Description (optional)">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl border border-border-default bg-white px-3 py-2 text-sm outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
        />
      </Field>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required for every employee
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={expiryTracked}
            onChange={(e) => setExpiryTracked(e.target.checked)}
          />
          Track expiry date
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-lg border border-border-default bg-white px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-subtle"
        >
          <X size={14} /> Cancel
        </button>
        <HrButton onClick={submit} disabled={create.isPending || update.isPending}>
          <Save size={14} className="mr-1" />
          {create.isPending || update.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </HrButton>
      </div>
    </div>
  )
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-text-tertiary">{hint}</p>}
  </div>
)

export default DocumentTypesTab
