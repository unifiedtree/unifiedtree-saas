// The top bar (HrmsPlatform.dc.html header): the Pages button, the page's tabs (HeaderTabs portal into
// the slot here) or one solid pill with the page's name, and on the right the "?q=" filter chip, the
// search and the bell. On a phone it adds the menu button and wraps the tabs onto a second row.
import type { ReactNode } from 'react'
import { PagePill } from '@/design/kit/display'
import { useHeaderSlotHost } from './HeaderTabs'
import { ShellIcon } from './shellIcons'

export interface TopBarProps {
  /** The Pages button (a module with several pages whose panel is closed). */
  pages: { label: string; onOpen: () => void } | null
  /** The page's name, shown as one solid pill when the page publishes no tabs. */
  pill: { label: string; icon: string } | null
  /** The page's "?q=" filter (pages that read it). */
  chip: { query: string; onClear: () => void } | null
  /** The desktop search. */
  search: ReactNode
  bell: ReactNode
  /** Phone only: opens the navigation drawer / the search sheet. */
  onMenu: () => void
  onSearch: () => void
  /** Phone only: the workspace tile. */
  mark: ReactNode
}

export function TopBar({ pages, pill, chip, search, bell, onMenu, onSearch, mark }: TopBarProps) {
  const { slotRef, hasBar } = useHeaderSlotHost()
  return (
    <header className="ut-topbar">
      <div className="ut-topbar__phone">
        <button type="button" className="ut-topbar__icon" onClick={onMenu} aria-label="Open navigation">
          <ShellIcon name="menu" size={22} />
        </button>
        <span className="ut-topbar__tile" aria-hidden="true">{mark}</span>
      </div>
      <div className="ut-topbar__main">
        {pages && (
          <button type="button" className="ut-topbar__pages" onClick={pages.onOpen} title="Show pages" aria-label={`Show pages: ${pages.label}`}>
            <ShellIcon name="panelOpen" size={16} />
            <span className="ut-topbar__pageslabel">{pages.label}</span>
          </button>
        )}
        <div ref={slotRef} className="ut-topbar__slot" data-empty={hasBar ? undefined : ''} />
        {!hasBar && pill && <PagePill label={pill.label} icon={<ShellIcon name={pill.icon} size={17} />} className="ut-topbar__pill" />}
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
