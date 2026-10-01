// Letter templates, on the kit (P-DOCS; prototype PgTalent h-letters tab 0):
// name (and variant), type, last updated, Active / Inactive, Edit and Delete.
// A row opens the template. Delete asks first. Used by the Letters hub and by
// Documents → Letter templates.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, CellActions, CellStack, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { useToast } from '@/design/kit/overlays'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useLetterTemplates, useDeleteTemplate, type LetterTemplateDto } from './api/useLetters'
import { LETTER_TYPE_LABEL, dayText, localDay } from './lettersModel'

/** The template list with its paging. */
export function LetterTemplatesList() {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirmDialog()
  const [page, setPage] = useState(0)
  const { data, isLoading, error, refetch, isFetching } = useLetterTemplates(page)
  const del = useDeleteTemplate()
  const canCreate = usePermission(P.HRMS_LETTERS_TEMPLATE_CREATE)
  const canEdit = usePermission(P.HRMS_LETTERS_TEMPLATE_UPDATE)
  const canDelete = usePermission(P.HRMS_LETTERS_TEMPLATE_DELETE)
  const templates: LetterTemplateDto[] = data?.content ?? []
  const total = data?.totalElements ?? 0

  const remove = async (t: LetterTemplateDto) => {
    const ok = await confirm({ title: `Delete “${t.name}”?`, body: 'Letters already generated from it stay as they are.', confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try { await del.mutateAsync(t.id); toast.success(`"${t.name}" deleted`) } catch (e) { toast.error('Couldn’t delete the template', { detail: (e as Error)?.message }) }
  }

  const columns: TableColumn<LetterTemplateDto>[] = [
    { key: 'name', header: 'Name', primary: true, render: (t) => <CellStack primary={t.name} secondary={t.variantName} /> },
    { key: 'type', header: 'Type', render: (t) => LETTER_TYPE_LABEL[t.type] ?? t.type },
    { key: 'updated', header: 'Last updated', render: (t) => dayText(localDay(t.updatedAt)) },
    { key: 'status', header: 'Status', render: (t) => <StatusPill tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</StatusPill> },
    ...(canEdit || canDelete ? [{
      key: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', align: 'right' as const,
      render: (t: LetterTemplateDto) => (
        <CellActions>
          {canEdit && <Button size={30} variant="secondary" aria-label={`Edit ${t.name}`} onClick={() => navigate(`/hrms/letters/templates/${t.id}`)}>Edit</Button>}
          {canDelete && <Button size={30} variant="secondary" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>Delete</Button>}
        </CellActions>
      ),
    }] : []),
  ]

  return (
    <Section title="Letter templates" body="flush" cardClass={false}
      loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
      empty={!isLoading && !error && templates.length === 0
        ? { title: 'No letter templates yet', hint: canCreate ? 'Create a template with merge fields, then generate letters from it.' : 'Templates HR creates appear here.' }
        : undefined}
      footer={total > 20 ? <Pager page={page} pageSize={20} total={total} onPageChange={setPage} /> : undefined}>
      <Table label="Letter templates" columns={columns} rows={templates} rowKey={(t) => t.id} mobile="cards"
        onRowClick={(t) => navigate(`/hrms/letters/templates/${t.id}`)} />
    </Section>
  )
}

/** Letter templates inside another page (Documents): the list with its own create button. */
export function LetterTemplates() {
  const navigate = useNavigate()
  const canCreate = usePermission(P.HRMS_LETTERS_TEMPLATE_CREATE)
  return (
    <div className="lt-stack">
      {canCreate && <div className="lt-row-end"><Button variant="primary" icon="plus" onClick={() => navigate('/hrms/letters/templates/new')}>Create template</Button></div>}
      <LetterTemplatesList />
    </div>
  )
}
