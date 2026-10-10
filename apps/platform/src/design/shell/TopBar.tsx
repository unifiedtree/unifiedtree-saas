// The top bar (HrmsPlatform.dc.html header): on the left the company selector, then the open module's pages
// as tabs (ModuleTabs), or, for a page that is its module's only page (or belongs to none), one solid pill
// with its name; on the right the "?q=" filter chip, the search and the bell. On a phone it adds the menu button and puts
// the tabs on a second row, as a sideways scroller. A page's own views are never up here: they sit inside
// the page, under this bar (DECISIONS 21).
import type { ReactNode } from 'react'
import { PagePill } from '@/design/kit/display'
import { ShellIcon } from './shellIcons'

export interface TopBarProps {
  /** The module's pages as tabs (ModuleTabs), when the module has several pages. */
  tabs: ReactNode
  /** The page's name as one solid pill, when there are no tabs. */
  pill: { label: string; icon: string } | null
  /** The page's "?q=" filter (pages that read it). */
  chip: { query: string; onClear: () => void } | null
  /** The company selector (CompanySwitcher), at the top left; renders nothing for people with no company. */
  company?: ReactNode
  /** The desktop search. */
  search: ReactNode
  bell: ReactNode
  /** Phone only: opens the navigation drawer / the search sheet. */
  onMenu: () => void
  onSearch: () => void
  /** Phone only: the workspace tile. */
  mark: ReactNode
}

export function TopBar({ tabs, pill, chip, company, search, bell, onMenu, onSearch, mark }: TopBarProps) {
  return (
    <header className="ut-topbar">
      <div className="ut-topbar__phone">
        <button type="button" className="ut-topbar__icon" onClick={onMenu} aria-label="Open navigation">
          <ShellIcon name="menu" size={22} />
        </button>
        <span className="ut-topbar__tile" aria-hidden="true">{mark}</span>
      </div>
      <div className="ut-topbar__main">
        {company}
        {tabs || (pill && <PagePill label={pill.label} icon={<ShellIcon name={pill.icon} size={16} />} className="ut-topbar__pill" />)}
      </div>
      <div className="ut-topbar__right">
        {chip && (
          <button type="button" className="ut-topbar__chip" onClick={chip.onClear} title="Clear the filter on this page" aria-label={`Clear the filter “${chip.query}” on this page`}>
            <ShellIcon name="filter" size={13} strokeWidth={2.2} />
            <span className="ut-topbar__chiptext">“{chip.query}”</span>
            <ShellIcon name="x" size={13} strokeWidth={2.4} />
          </button>
        )}
        <div className="ut-topbar__search">{search}</div>
        <button type="button" className="ut-topbar__icon ut-topbar__searchicon" onClick={onSearch} aria-label="Search">
          <ShellIcon name="search" size={20} />
        </button>
        {bell}
      </div>
    </header>
  )
}
