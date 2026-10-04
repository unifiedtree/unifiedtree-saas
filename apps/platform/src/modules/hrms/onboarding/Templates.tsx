// Onboarding checklist templates on the redesign kit (P-HIRE; prototype PgTalent h-onb,
// Checklist templates). Stands alone at /hrms/onboarding and also sits inside Onboarding &
// assets as a view (`embedded`), which is where the menu leads. Each template shows its
// tasks, how many new hires it was used for (BW-69) and whether it's offered.
// Read: hrms.onboarding.template.read; New template, Archive: template.write.
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, CellActions, CellStack, PageFrame, PageHeader, Section, StatusPill, Table, type TableColumn } from '@/design/kit/display'
import { Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useTemplates, useCreateTemplate, useDeleteTemplate, type OnboardingTemplate } from './api/useOnboarding'
import { useCompanies } from '../api/useOrg'
import '../hiring/hiring.css'

const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'

function CreateTemplatePanel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const create = useCreateTemplate()
  const { data: companies = [] } = useCompanies()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [nameError, setNameError] = useState('')
  useEffect(() => { if (!companyId && companies.length) setCompanyId(companies[0].id) }, [companies, companyId])
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) { setNameError('Give the template a name'); return }
    if (!companyId) { toast.error('Add a company first', { detail: 'Templates belong to a company (Organization → Companies).' }); return }
    try {
      await create.mutateAsync({ companyId, name: name.trim(), description: description.trim() || undefined, active: true })
      toast.success('Template created', { detail: 'Open it to add its tasks.' })
      onClose()
    } catch (err) { toast.error('Couldn’t create the template', { detail: errText(err) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={520} busy={create.isPending} closeLabel="Close panel" title="New checklist template"
      sub="Add the tasks after creating it. Every new hire on this template works through them."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={create.isPending} onClick={() => submit()}>Create template</PanelButton></>}>
      <form id="tpl-create" onSubmit={submit} noValidate>
        <FieldGrid columns={1}>
          {companies.length > 1 && (
            <Select id="tpl-company" label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          <Input id="tpl-name" label="Template name" required value={name} maxLength={200} placeholder="e.g. Engineering onboarding" error={nameError || undefined}
            onChange={(e) => { setName(e.target.value); setNameError('') }} />
          <Textarea id="tpl-desc" label="Description" rows={3} value={description} maxLength={2000} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
        </FieldGrid>
      </form>
    </SidePanel>
  )
}

export const Templates: React.FC<{ embedded?: boolean; creating?: boolean; onCreateDone?: () => void }> = ({ embedded, creating, onCreateDone }) => {
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const [ownCreate, setOwnCreate] = useState(false)
  const [archiving, setArchiving] = useState<OnboardingTemplate | null>(null)
  const { data: templates = [], isLoading, error, refetch, isFetching } = useTemplates()
  const del = useDeleteTemplate()
  const archive = async () => {
    if (!archiving) return
    try { await del.mutateAsync(archiving.id); toast.success('Template archived', { detail: archiving.name }); setArchiving(null) }
    catch (e) { toast.error('Couldn’t archive the template', { detail: errText(e) }) }
  }
  // Active first, then archived (as before).
  const rows = [...templates.filter((t) => t.active), ...templates.filter((t) => !t.active)]
  const open = (t: OnboardingTemplate) => navigate(`/hrms/onboarding/templates/${t.id}`)
  const columns: TableColumn<OnboardingTemplate>[] = [
    { key: 'name', header: 'Template', primary: true, width: '36%', render: (t) => <CellStack primary={t.name} secondary={t.description || undefined} /> },
    { key: 'tasks', header: 'Tasks', render: (t) => { const n = t.tasks?.length ?? 0; return <span className="hi-num">{`${n} ${n === 1 ? 'task' : 'tasks'}`}</span> } },
    { key: 'used', header: 'Used by', render: (t) => <span className="hi-num">{t.usedBy == null ? '—' : `${t.usedBy} ${t.usedBy === 1 ? 'hire' : 'hires'}`}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Archived'}</StatusPill> },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (t) => (
        <CellActions>
          <Button size={30} variant="secondary" onClick={() => open(t)} aria-label={canWrite ? `Edit ${t.name}` : `Open ${t.name}`}>{canWrite ? 'Edit' : 'Open'}</Button>
          {t.active && canWrite && <Button size={30} variant="danger-outline" disabled={del.isPending} onClick={() => setArchiving(t)} aria-label={`Archive ${t.name}`}>Archive</Button>}
        </CellActions>
      ),
    },
  ]
  const body = (
    <>
      <Section title="Checklist templates" body="flush" loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isFetching}
        empty={!isLoading && !error && templates.length === 0 ? {
          title: 'No templates yet', icon: 'list',
          hint: canWrite ? 'Create a template with the tasks every new hire should finish, like IT setup or policy sign-off.' : 'HR hasn’t set up any onboarding checklists yet.',
        } : undefined}>
        <Table label="Checklist templates" columns={columns} rows={rows} rowKey={(t) => t.id} mobile="cards" onRowClick={open} rowClassName={(t) => (t.active ? undefined : 'hi-muted')} />
      </Section>
      {(creating || ownCreate) && <CreateTemplatePanel onClose={() => { setOwnCreate(false); onCreateDone?.() }} />}
      <Dialog open={!!archiving} onClose={() => setArchiving(null)} busy={del.isPending} icon="archive" tone="danger" title={`Archive “${archiving?.name ?? ''}”?`}
        sub="It won’t be offered for new hires any more. Onboardings already started keep their checklist."
        footer={<><PanelButton onClick={() => setArchiving(null)} disabled={del.isPending}>Keep it</PanelButton><PanelButton variant="danger" busy={del.isPending} onClick={archive}>Archive</PanelButton></>} />
    </>
  )
  if (embedded) return body
  return (
    <PageFrame label="Checklist templates" className="hi-page">
      <PageHeader eyebrow="Onboarding" title="Checklist templates" sub="Reusable task lists for new hires."
        actions={canWrite ? <Button variant="primary" size={40} icon="plus" onClick={() => setOwnCreate(true)}>New template</Button> : undefined} />
      {body}
    </PageFrame>
  )
}
