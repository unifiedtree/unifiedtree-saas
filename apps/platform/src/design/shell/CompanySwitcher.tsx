// The company selector (master context §9): the HRMS company the person is working in, by name, and a
// menu of the others they may open, plus "Add company" for people who can open Companies. Shown to
// everyone with a company, also with only one (owner, 10 Oct 2026): at the top left of the Apps page,
// and in HRMS as the rail's top block (opens on hover or click). A pick switches every HRMS page at
// once (modules/hrms/company/CurrentCompany); a page with unsaved changes asks first, as it does
// before any other move.
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Plus } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Menu } from '@/design/kit/Menu'
import { mayLeaveCompany, useCurrentCompany } from '@/modules/hrms/company/CurrentCompany'
import { guardedGo } from './navigationGuard'
import { ShellIcon } from './shellIcons'

export interface CompanySwitcherProps {
  /** 'bar' (default): a button in a top bar. 'rail': the HRMS rail's top block (tile, business, company). */
  variant?: 'bar' | 'rail'
  /** Rail only: the workspace tile and the business's name. */
  mark?: ReactNode
  workspaceName?: string | null
}

export function CompanySwitcher({ variant = 'bar', mark, workspaceName }: CompanySwitcherProps) {
  const { companies, company, multi, setCompany } = useCurrentCompany()
  const navigate = useNavigate()
  const canAdd = usePermission(P.HRMS_BRANCH_READ)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  // The rail opens the menu on hover; a click right after that hover keeps it open instead of closing it.
  const hoverOpenedAt = useRef(0)
  if (!company) return null

  const addCompany = () => { setOpen(false); guardedGo(() => navigate('/hrms/companies')) }
  const label = `Company: ${company.name}. Switch company`

  return (
    <>
      {variant === 'rail' ? (
        <button ref={anchor} type="button" className="ut-rail__brand ut-rail__cosel" data-open={open ? '' : undefined}
          aria-haspopup="menu" aria-expanded={open} aria-label={label} title={company.name}
          onMouseEnter={() => { if (!open) { hoverOpenedAt.current = Date.now(); setOpen(true) } }}
          onClick={() => { if (open && Date.now() - hoverOpenedAt.current < 1500) return; setOpen((v) => !v) }}>
          <span className="ut-rail__tile" aria-hidden="true">{mark}</span>
          <span className="ut-rail__ws ut-rail__wsco">
            <span className="ut-rail__wsname">{workspaceName || company.name}</span>
            <span className="ut-rail__coname">{company.name}</span>
          </span>
          <ChevronDown className="ut-rail__cochev" size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : (
        <button ref={anchor} type="button" className="ut-cosel" data-open={open ? '' : undefined}
          aria-haspopup="menu" aria-expanded={open} aria-label={label} title={company.name}
          onClick={() => setOpen((v) => !v)}>
          <ShellIcon name="building" size={16} />
          <span className="ut-cosel__name">{company.name}</span>
          <ChevronDown className="ut-cosel__chev" size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
      <Menu
        label="Companies"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchor}
        placement="bottom-start"
        selection="radio"
        width={300}
        maxHeight={420}
        header={multi
          ? { title: 'Switch company', sub: 'Every HRMS page shows the company you pick.' }
          : { title: 'Your company', sub: 'Every HRMS page shows this company.' }}
        items={companies.map((c) => ({
          key: c.id,
          label: c.name,
          sub: c.role || undefined,
          icon: <ShellIcon name="building" size={18} />,
          checked: c.id === company.id,
          onSelect: () => { if (c.id !== company.id) guardedGo(() => { if (mayLeaveCompany()) setCompany(c.id) }) },
        }))}
        footer={canAdd ? (
          <button type="button" className="ut-cosel__add" onClick={addCompany}>
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
            <span>Add company</span>
          </button>
        ) : undefined}
      />
    </>
  )
}
