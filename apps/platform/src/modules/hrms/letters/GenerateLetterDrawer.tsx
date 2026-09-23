import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrDrawer } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { useEmployeeDirectory, useWorkforceEmployee, type WorkforceEmployee } from '../api/useWorkforce'
import { useGenerateLetter, useLetterTemplates, type LetterTemplateDto } from './api/useLetters'

function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error instanceof Error ? error.message : 'Unable to load this information.'}</p>{retry && <HrButton variant="ghost" size="sm" className="mt-2" onClick={retry}>Try again</HrButton>}</div>
}

export function GenerateLetterDrawer({ onClose, initialEmployeeId = '' }: { onClose: () => void; initialEmployeeId?: string }) {
  const navigate = useNavigate()
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadTemplates = usePermission(P.HRMS_LETTERS_TEMPLATE_READ)
  const canCreateTemplate = usePermission(P.HRMS_LETTERS_TEMPLATE_CREATE)
  const [templatePage, setTemplatePage] = useState(0)
  const [template, setTemplate] = useState<LetterTemplateDto | null>(null)
  const templates = useLetterTemplates(templatePage, { enabled: canReadTemplates })
  const [employeePage, setEmployeePage] = useState(0)
  const [search, setSearch] = useState('')
  const [employee, setEmployee] = useState<WorkforceEmployee | null>(null)
  const initialEmployee = useWorkforceEmployee(canReadEmployees ? initialEmployeeId : undefined)
  const selectedEmployee = employee || initialEmployee.data
  const employees = useEmployeeDirectory({ companyId: template?.companyId, search: search.trim() || undefined, page: employeePage, pageSize: 10 }, { enabled: canReadEmployees && !!template })
  const generate = useGenerateLetter()
  const sameCompany = !selectedEmployee || !template || selectedEmployee.companyId === template.companyId
  const submit = async () => {
    if (!template || !selectedEmployee || !sameCompany) return
    try {
      const result = await generate.mutateAsync({ templateId: template.id, employeeId: selectedEmployee.id, sendImmediately: false })
      onClose()
      navigate(`/hrms/letters/generated/${result.id}`)
    } catch { /* Keep the real error visible in the drawer. */ }
  }
  return <HrDrawer title="Generate letter" width="max-w-2xl" onClose={() => { if (!generate.isPending) onClose() }} footer={<><HrButton variant="ghost" disabled={generate.isPending} onClick={onClose}>Cancel</HrButton><HrButton disabled={!template || !selectedEmployee || !sameCompany || generate.isPending} onClick={submit}>{generate.isPending ? 'Generating...' : 'Generate PDF'}</HrButton></>}>
    <div className="space-y-6">
      <p className="text-sm text-text-secondary">Choose a company template and employee to create a PDF for review. Generating a letter saves it without sending an email.</p>
      <section className="space-y-3"><h3 className="font-semibold">1. Choose a template</h3>
        {!canReadTemplates ? <p className="text-sm text-text-secondary">Template access is required to generate a letter. Ask your administrator to enable template viewing.</p> : templates.isError ? <Failure error={templates.error} retry={() => templates.refetch()} /> : <>
          {templates.isLoading ? <p role="status" className="text-sm">Loading templates...</p> : <div className="space-y-2">{templates.data?.content.filter(item => item.active).map(item => <button type="button" key={item.id} aria-pressed={template?.id === item.id} onClick={() => { setTemplate(item); setEmployeePage(0); setSearch('') }} className={`w-full rounded-lg border p-3 text-left ${template?.id === item.id ? 'border-[#0F6E56] bg-[#E6F4F1]' : 'border-border-default hover:bg-bg-base'}`}><span className="block text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-text-secondary">{item.type.replaceAll('_', ' ').toLowerCase()} · {item.subject}</span></button>)}{!templates.data?.content.some(item => item.active) && <p className="text-sm text-text-secondary">No active templates on this page.{canCreateTemplate && <button className="ml-1 text-[#0F6E56] underline" onClick={() => navigate('/hrms/letters/templates/new')}>Create a template</button>}</p>}</div>}
          <HrPagination page={templatePage} pageSize={20} totalElements={templates.data?.totalElements ?? 0} totalPages={templates.data?.totalPages ?? 0} onPageChange={setTemplatePage} />
        </>}
        {template && <p className="text-xs text-[#0A5240]">Selected template: {template.name}</p>}
      </section>
      <section className="space-y-3"><h3 className="font-semibold">2. Choose the employee</h3>
        {selectedEmployee && <div className="rounded-lg bg-[#E6F4F1] p-3 text-sm"><strong>{selectedEmployee.firstName} {selectedEmployee.lastName}</strong><span className="ml-2 text-text-secondary">{selectedEmployee.employeeCode}</span></div>}
        {!sameCompany && <p role="alert" className="text-sm text-red-700">The selected employee belongs to a different company. Choose an employee listed below or change the template.</p>}
        {initialEmployee.isError && <Failure error={initialEmployee.error} retry={() => initialEmployee.refetch()} />}
        {!canReadEmployees ? <p className="text-sm text-text-secondary">Employee directory access is required to choose a recipient.</p> : !template ? <p className="text-sm text-text-secondary">Choose a template first to find employees in its company.</p> : <>
          <label className="block text-sm font-medium">Find employee<input type="search" value={search} className="ut-input mt-1" placeholder="Search name, code or email" onChange={event => { setSearch(event.target.value); setEmployeePage(0) }} /></label>
          {employees.isError ? <Failure error={employees.error} retry={() => employees.refetch()} /> : <><div className="max-h-64 overflow-y-auto rounded-lg border border-border-default" aria-busy={employees.isFetching}>{employees.isLoading ? <p role="status" className="p-3 text-sm">Loading employees...</p> : !employees.data?.content.length ? <p className="p-3 text-sm text-text-secondary">No employees match this search.</p> : employees.data.content.map(item => <button type="button" key={item.id} aria-pressed={selectedEmployee?.id === item.id} onClick={() => setEmployee(item)} className={`block w-full border-b border-border-default p-3 text-left text-sm last:border-0 hover:bg-[#E6F4F1] ${selectedEmployee?.id === item.id ? 'bg-[#E6F4F1]' : ''}`}><span className="block font-semibold">{item.firstName} {item.lastName}</span><span className="text-xs text-text-secondary">{item.employeeCode} · {item.email}</span></button>)}</div><HrPagination page={employeePage} pageSize={10} totalElements={employees.data?.totalElements ?? 0} totalPages={employees.data?.totalPages ?? 0} onPageChange={setEmployeePage} /></>}
        </>}
      </section>
      {generate.isError && <Failure error={generate.error} />}
    </div>
  </HrDrawer>
}
