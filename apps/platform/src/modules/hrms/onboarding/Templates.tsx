// Onboarding checklist templates on the redesign kit (prototype PgTalent h-onb "Checklist
// templates"). Stands alone at /hrms/onboarding and also sits inside Onboarding & assets as a view
// (`embedded`; that page owns the "New template" button then). Each row: tasks, how many hires it
// was used for (BW-69 usedBy), Active / Archived, Edit (opens the template) and Archive.
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { Button, Callout, CellActions, PageFrame, PageHeader, Section, StatusPill, Table, errorText, type TableColumn } from '@/design/kit/display'
import { Dialog, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useTemplates, useCreateTemplate, useDeleteTemplate } from './api/useOnboarding'
import type { OnboardingTemplate } from './api/useOnboarding'
import { useCompanies } from '../api/useOrg'
import { useCurrentCompany } from '../company/CurrentCompany'
import { usedByText } from './onboardingModel'
import './onboarding.css'

/** New checklist template: company (when there's a choice), name, description. Tasks are added on its page. */
export function CreateTemplatePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTemplate()
  const toast = useToast()
  const companies = useCompanies()
  const list = useMemo(() => companies.data ?? [], [companies.data])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setName(''); setDescription(''); setError('') } }, [open])
  // Starts on the company the top bar's selector is on.
  const { companyId: currentCompanyId } = useCurrentCompany()
  useEffect(() => { if (!companyId && list.length) setCompanyId(list.some((c) => c.id === currentCompanyId) ? currentCompanyId : list[0].id) }, [list, companyId, currentCompanyId])
  const close = () => { if (!create.isPending) onClose() }
  const submit = async () => {
    if (!name.trim()) return
    if (!companyId) { setError('Templates belong to a company. Add a company first (Organization → Companies).'); return }
    setError('')
    try {
      await create.mutateAsync({ companyId, name: name.trim(), description: description.trim() || undefined, active: true })
      toast.success('Template created', { detail: 'Open it to add its tasks.' }); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t create the template.')) }
  }
  return (
    <SidePanel open={open} onClose={close} busy={create.isPending} width={480} closeLabel="Close panel" title="New checklist template"
      sub="Add the tasks after creating it. Every new hire on this template works through them."
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={create.isPending} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={create.isPending} blockedReason={!name.trim() ? 'Give the template a name' : null} onClick={submit}>Create template</PanelButton>
      </>}>
      <form className="onb-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {list.length > 1 && (
          <Select label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={list.map((c) => ({ value: c.id, label: c.name }))} />
        )}
        <Input id="tpl-name" label="Template name" required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering onboarding" />
        <Textarea id="tpl-desc" label="Description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        {companies.isError && <Callout tone="danger" icon="alert"><span role="alert">Couldn’t load companies. <button type="button" className="onb-link" onClick={() => companies.refetch()}>Try again</button></span></Callout>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </form>
    </SidePanel>
  )
}

export const Templates: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const navigate = useNavigate()
  const canWrite = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const toast = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [archiving, setArchiving] = useState<OnboardingTemplate | null>(null)
  const { data: templates = [], isLoading, error, refetch, isRefetching } = useTemplates()
  const del = useDeleteTemplate()
  // Active first, archived after, as before.
  const rows = [...templates.filter((t) => t.active), ...templates.filter((t) => !t.active)]
  const archive = async () => {
    if (!archiving) return
    try { await del.mutateAsync(archiving.id); toast.success('Template archived'); setArchiving(null) }
    catch (e) { toast.error('Couldn’t archive the template', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const open = (t: OnboardingTemplate) => navigate(`/hrms/onboarding/templates/${t.id}`)
  const columns: TableColumn<OnboardingTemplate>[] = [
    {
      key: 'name', header: 'Template', primary: true, render: (t) => (
        <span className="onb-cell2"><span className="onb-strong">{t.name}</span>{t.description && <span className="onb-muted onb-clip" title={t.description}>{t.description}</span>}</span>
      ),
    },
    { key: 'tasks', header: 'Tasks', numeric: true, align: 'left', render: (t) => t.tasks?.length ?? 0 },
    { key: 'used', header: 'Used by', render: (t) => <span className="onb-num">{usedByText(t.usedBy)}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill tone={t.active ? 'success' : 'muted'}>{t.active ? 'Active' : 'Archived'}</StatusPill> },
    {
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (t) => (
        <CellActions>
          <Button variant="secondary" size={30} onClick={() => open(t)} aria-label={canWrite ? `Edit ${t.name}` : `Open ${t.name}`}>{canWrite ? 'Edit' : 'Open'}</Button>
          {t.active && canWrite && <Button variant="danger-outline" size={30} disabled={del.isPending} onClick={() => setArchiving(t)} aria-label={`Archive ${t.name}`}>Archive</Button>}
        </CellActions>
      ),
    },
  ]
  const body = (
    <Section title="Checklist templates" body="flush" loading={isLoading} skeleton="table" error={error} onRetry={() => refetch()} retrying={isRefetching}
      empty={!templates.length ? {
        title: 'No templates yet', icon: 'list', variant: 'plain',
        hint: canWrite ? 'Create a template with the tasks every new hire should finish, like IT setup or policy sign-off.' : 'HR hasn’t set up any onboarding checklists yet.',
      } : undefined}>
      <Table label="Checklist templates" columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={open} mobile="cards"
        rowClassName={(t) => (t.active ? undefined : 'onb-muted-row')} />
      <Dialog open={!!archiving} onClose={() => { if (!del.isPending) setArchiving(null) }} busy={del.isPending} tone="danger" icon="archive"
        title={archiving ? `Archive “${archiving.name}”?` : 'Archive template?'} sub="It won’t be offered for new hires any more. Onboardings already started keep their checklist."
        footer={<>
          <PanelButton variant="secondary" disabled={del.isPending} onClick={() => setArchiving(null)}>Keep it</PanelButton>
          <PanelButton variant="danger" busy={del.isPending} onClick={archive}>Archive</PanelButton>
        </>} />
    </Section>
  )
  if (embedded) return body
  return (
    <PageFrame label="Checklist templates">
      <PageHeader eyebrow="Onboarding" title="Checklist templates" sub="Reusable task lists for new hires."
        actions={canWrite ? <Button variant="primary" size={40} icon="plus" onClick={() => setCreateOpen(true)}>New template</Button> : undefined} />
      {body}
      <CreateTemplatePanel open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageFrame>
  )
}
