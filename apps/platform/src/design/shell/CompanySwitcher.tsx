// The top bar's company selector (master context §9): the HRMS company the person is working in, by
// name, and a menu of the others they may open. Shown only to people with two or more companies; a
// pick switches every HRMS page at once (modules/hrms/company/CurrentCompany); a page with unsaved
// changes asks first, as it does before any other move.
import { ChevronDown } from 'lucide-react'
import { Menu } from '@/design/kit/Menu'
import { mayLeaveCompany, useCurrentCompany } from '@/modules/hrms/company/CurrentCompany'
import { roleLabel } from '@/shared/navigation/roleLabels'
import { guardedGo } from './navigationGuard'
import { ShellIcon } from './shellIcons'

export function CompanySwitcher() {
  const { companies, company, multi, setCompany } = useCurrentCompany()
  if (!multi || !company) return null
  return (
    <Menu
      label="Companies"
      selection="radio"
      width={300}
      maxHeight={420}
      header={{ title: 'Switch company', sub: 'Every HRMS page shows the company you pick.' }}
      items={companies.map((c) => ({
        key: c.id,
        label: c.name,
        sub: c.role ? roleLabel(c.role) : undefined,
        icon: <ShellIcon name="building" size={18} />,
        checked: c.id === company.id,
        onSelect: () => { if (c.id !== company.id) guardedGo(() => { if (mayLeaveCompany()) setCompany(c.id) }) },


      }))}
      trigger={({ props, open }) => (
        <button type="button" {...props} className="ut-cosel" data-open={open ? '' : undefined}
          aria-label={`Company: ${company.name}. Switch company`} title={company.name}>
          <ShellIcon name="building" size={16} />
          <span className="ut-cosel__name">{company.name}</span>
          <ChevronDown className="ut-cosel__chev" size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
    />
  )
}

