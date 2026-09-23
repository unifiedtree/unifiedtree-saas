import { Button, HrStatusPill, PageHeader } from '@unifiedtree/design-sync-entry'
import { Download, MoreHorizontal, Pencil, Plus } from 'lucide-react'

// The list-screen header: a breadcrumb trail, title, one-line description
// and the action pair (secondary export + primary add) directory screens carry.
export function EmployeeDirectory() {
  return (
    <PageHeader
      breadcrumbs={[{ label: 'HRMS', href: '#' }, { label: 'Employees' }]}
      title="Employees"
      description="412 active · 6 on notice · 3 joining this month"
      actions={
        <>
          <Button variant="outline"><Download size={16} /> Export</Button>
          <Button><Plus size={16} /> Add employee</Button>
        </>
      }
    />
  )
}

// A record header: three-level breadcrumbs and the meta slot carrying status
// pills and identifiers beneath the description.
export function EmployeeRecord() {
  return (
    <PageHeader
      breadcrumbs={[{ label: 'HRMS', href: '#' }, { label: 'Employees', href: '#' }, { label: 'Priya Raghavan' }]}
      title="Priya Raghavan"
      description="Senior Engineer · Engineering · Bengaluru"
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <HrStatusPill tone="ok">Active</HrStatusPill>
          <HrStatusPill tone="teal">Work from home</HrStatusPill>
          <span className="text-xs text-gray-500">EMP-0142 · Joined 3 Mar 2021 · Reports to Arjun Mehta</span>
        </div>
      }
      actions={
        <>
          <Button variant="outline"><Pencil size={16} /> Edit</Button>
          <Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal size={18} /></Button>
        </>
      }
    />
  )
}

// A module landing page: no breadcrumbs, one primary action.
export function SingleAction() {
  return (
    <PageHeader
      title="Payroll runs"
      description="Process monthly payroll, review payslips and lock the period."
      actions={<Button><Plus size={16} /> New run</Button>}
    />
  )
}

// The minimal form a settings section uses: title and description only.
export function TitleAndDescription() {
  return (
    <PageHeader
      title="Leave policies"
      description="Accrual rules, carry-forward limits and holiday calendars for each company."
    />
  )
}
