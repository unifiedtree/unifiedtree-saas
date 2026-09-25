// Onboarding checklist templates, on the module kit. Stands alone at
// /hrms/onboarding and also sits inside Onboarding & assets as a view
// (`embedded`), which is where the sidebar leads.
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton, HrDrawer, HrStatusPill, HrSelect } from '@/shared/components/hr'
import { ModulePage, State, RowList, Row, SubHeading, useDesignToast } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useTemplates, useCreateTemplate, useDeleteTemplate } from './api/useOnboarding'
import type { OnboardingTemplate } from './api/useOnboarding'
import { useCompanies } from '../api/useOrg'

const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

function CreateTemplateDrawer({ onClose, onDone }: { onClose: () => void; onDone: (msg: string, err?: boolean, detail?: string) => void }) {
  const create = useCreateTemplate()
  const { data: companies = [] } = useCompanies()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [companyId, setCompanyId] = useState('')
  useEffect(() => { if (!companyId && companies.length) setCompanyId(companies[0].id) }, [companies, companyId])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (!companyId) { onDone('Add a company first', true, 'Templates belong to a company (Organization → Companies).'); return }
    try {
      await create.mutateAsync({ companyId, name: name.trim(), description: description.trim() || undefined, active: true })
      onDone('Template created'); onClose()
    } catch (err) { onDone('Couldn’t create the template', true, (err as Error)?.message) }
  }
  return (
    <HrDrawer title="New checklist template" onClose={onClose}
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="tpl-create" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Creating…' : 'Create template'}</HrButton></>}>
      <form id="tpl-create" onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-text-secondary">Add the tasks after creating it. Every new hire on this template works through them.</p>
        {companies.length > 1 && (
          <div><span className={label}>Company</span><HrSelect value={companyId} onChange={setCompanyId} options={companies.map((c) => ({ value: c.id, label: c.name }))} /></div>
        )}
        <div><label className={label} htmlFor="tpl-name">Template name</label><input id="tpl-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering hire" className="ut-input" /></div>
        <div><label className={label} htmlFor="tpl-desc">Description</label><textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" rows={3} className="ut-input resize-none" /></div>
      </form>
    </HrDrawer>
  )
}

export const Templates: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const navigate = useNavigate()
  const canWrite = usePermission(P.HRMS_ONBOARDING_TEMPLATE_WRITE)
  const [createOpen, setCreateOpen] = useState(false)
  const { show, node } = useDesignToast()
  const { data: templates = [], isLoading, error, refetch } = useTemplates()
  const del = useDeleteTemplate()
  const archive = async (t: OnboardingTemplate) => {
    if (!window.confirm(`Archive “${t.name}”? It won’t be offered for new hires any more.`)) return
    try { await del.mutateAsync(t.id); show('Template archived') } catch (e) { show('Couldn’t archive the template', true, (e as Error)?.message) }
  }
  const addBtn = canWrite ? <HrButton size={embedded ? 'sm' : undefined} onClick={() => setCreateOpen(true)}><Plus size={15} /> New template</HrButton> : undefined
  const active = templates.filter((t) => t.active), archived = templates.filter((t) => !t.active)
  const list = (rows: OnboardingTemplate[]) => (
    <RowList>
      {rows.map((t) => {
        const n = t.tasks?.length ?? 0
        return (
          <Row key={t.id} muted={!t.active} onClick={() => navigate(`/hrms/onboarding/templates/${t.id}`)}
            lead={<span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: '#ecfdf5', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('list', 16)}</span>}
            title={t.name} meta={t.description || undefined}
            trail={<>
              <span style={{ fontSize: 12.5, color: '#475569' }}>{`${n} ${n === 1 ? 'task' : 'tasks'}`}</span>
              <HrStatusPill tone={t.active ? 'ok' : 'gray'}>{t.active ? 'Active' : 'Archived'}</HrStatusPill>
              {t.active && canWrite && (
                <span role="presentation" onClick={(e) => e.stopPropagation()}>
                  <HrButton size="sm" variant="ghost" disabled={del.isPending} onClick={() => archive(t)} aria-label={`Archive ${t.name}`}>Archive</HrButton>
                </span>
              )}
            </>} />
        )
      })}
    </RowList>
  )
  const body = (
    <div style={{ display: 'grid', gap: 16 }}>
      {embedded && <SubHeading aside={addBtn}>Checklist templates</SubHeading>}
      {isLoading ? <State kind="loading" />
        : error ? <State kind="error" title="Couldn’t load templates" description={(error as Error).message} onRetry={() => refetch()} />
          : templates.length === 0 ? <State kind="empty" icon="list" title="No templates yet" description={canWrite ? 'Create a template with the tasks every new hire should finish, like IT setup or policy sign-off.' : 'HR hasn’t set up any onboarding checklists yet.'} />
            : <>{active.length > 0 && list(active)}{archived.length > 0 && <><SubHeading>Archived</SubHeading>{list(archived)}</>}</>}
      {createOpen && <CreateTemplateDrawer onClose={() => setCreateOpen(false)} onDone={show} />}
      {node}
    </div>
  )
  if (embedded) return body
  return (
    <ModulePage crumb="Onboarding" title="Checklist templates" subtitle="Reusable task lists for new hires." actions={addBtn}>
      {body}
    </ModulePage>
  )
}
