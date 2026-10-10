// The rail (HrmsPlatform.dc.html aside): 72px of icons, 248px with labels on hover or keyboard focus
// (an overlay), or pinned open (it then takes its room). Named groups with a label row, items that
// don't fit move into More (the shell measures and fits them), and More at the bottom.
// Behaviour (what an item opens, which one is lit) comes from PlatformShell.
import type { MouseEvent, ReactNode } from 'react'
import { ShellIcon } from './shellIcons'

export interface RailItem {
  key: string
  /** The label on the rail. */
  label: string
  /** Accessible name and tooltip ("My leave" for My work's Leave). */
  name: string
  icon: string
  /** Where a click lands (a real link: open in a new tab works). */
  href: string
  lit: boolean
  /** The module has several pages (the lit item shows a chevron). */
  hasPages: boolean
  soon: boolean
}

export interface RailGroupView { key: string; label: string; items: RailItem[] }

export interface AppRailProps {
  groups: RailGroupView[]
  workspaceName: string | null
  /** The workspace tile's content (its mark, or the monogram). */
  mark: ReactNode
  /** Where the top block goes (the person's Home) and its name. */
  homeHref: string
  homeLabel: string
  onHome: () => void
  pinned: boolean
  onTogglePin: () => void
  /** The rail takes 248px of room (pinned). */
  push: boolean
  /** Hover doesn't widen the rail (More is open over the page). */
  noExpand: boolean
  more: { open: boolean; lit: boolean; count: number; onToggle: () => void }
  onItem: (key: string) => void
  onIntent?: (href: string) => void
  /** The list's element, measured for the overflow. */
  listRef: (el: HTMLDivElement | null) => void
  /** The More panel, placed at the rail's edge. */
  children?: ReactNode
  /** Replaces the top block's Home link (the company selector, CompanySwitcher variant 'rail'). */
  brand?: ReactNode
}

/** A plain left click stays in the app; modified clicks (new tab, new window) are the browser's. */
function inApp(e: MouseEvent, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

export function AppRail({ groups, workspaceName, mark, homeHref, homeLabel, onHome, pinned, onTogglePin, push, noExpand, more, onItem, onIntent, listRef, children, brand }: AppRailProps) {
  const pinLabel = pinned ? 'Collapse sidebar' : 'Keep sidebar open'
  const moreOn = more.open || more.lit
  return (
    <div className="ut-railwrap" data-push={push ? '' : undefined} data-noexpand={noExpand ? '' : undefined}>
      <nav aria-label="Primary" className="ut-rail">
        <div className="ut-rail__top">
          {brand ?? (
            <a href={homeHref} className="ut-rail__brand" aria-label={workspaceName ? `${workspaceName} · ${homeLabel}` : homeLabel}
              title={homeLabel} onClick={(e) => inApp(e, onHome)}>
              <span className="ut-rail__tile" aria-hidden="true">{mark}</span>
              <span className="ut-rail__ws">{workspaceName ?? ''}</span>
            </a>
          )}
          <button type="button" className="ut-rail__pin" onClick={onTogglePin} aria-label={pinLabel} title={pinLabel}>
            <ShellIcon name={pinned ? 'chevronLeft' : 'pin'} size={16} strokeWidth={2} />
          </button>
        </div>
        <div ref={listRef} className="ut-rail__list">
          {groups.map((g, gi) => (
            <div key={g.key} role="group" aria-label={g.label} className="ut-rail__grp">
              {gi > 0 && (
                <div className="ut-rail__sep" aria-hidden="true">
                  <span className="ut-rail__sepline" />
                  <span className="ut-rail__seplabel">{g.label}</span>
                </div>
              )}
              {g.items.map((n) => (
                <a key={n.key} href={n.href} className="ut-rail__item" data-lit={n.lit ? '' : undefined}
                  aria-current={n.lit ? 'page' : undefined} aria-label={n.name !== n.label ? n.name : undefined} title={n.name}
                  onClick={(e) => inApp(e, () => onItem(n.key))}
                  onMouseEnter={onIntent ? () => onIntent(n.href) : undefined} onFocus={onIntent ? () => onIntent(n.href) : undefined}>
                  <ShellIcon name={n.icon} size={20} />
                  <span className="ut-rail__label">{n.label}</span>
                  {n.soon && <span className="ut-rail__soon">Soon</span>}
                  {n.lit && n.hasPages && <ShellIcon name="chevronRight" size={14} strokeWidth={2.2} className="ut-rail__chev" />}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="ut-rail__foot">
          <button type="button" className="ut-rail__item ut-rail__more" data-lit={moreOn ? '' : undefined} onClick={more.onToggle}
            aria-label={more.count ? `More, ${more.count} more ${more.count === 1 ? 'module' : 'modules'}` : 'More'} title="More"
            aria-haspopup="dialog" aria-expanded={more.open} aria-current={more.lit && !more.open ? 'page' : undefined}>
            <span className="ut-rail__moreicon">
              <ShellIcon name="grid" size={20} />
              {more.count > 0 && !moreOn && <span className="ut-rail__dot" aria-hidden="true" />}
            </span>
            <span className="ut-rail__label">More</span>
            {more.count > 0 && <span className="ut-rail__badge" aria-hidden="true">+{more.count}</span>}
          </button>
        </div>
      </nav>
      {children}
    </div>
  )
}
