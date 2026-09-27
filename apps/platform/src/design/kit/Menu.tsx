// The design's menus (role menu, notifications list, row actions): a Popover with a header,
// rows with an optional round avatar tile, label, sub-line and meta, ticks for the chosen one,
// separators and a footer. Keyboard as a menu button: Arrow keys, Home/End, typing a letter,
// Enter/Space to choose, Escape to close (focus back on the trigger), Tab to move on.
import {
  isValidElement, useEffect, useId, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react'
import { Check } from 'lucide-react'
import { Popover, type PopoverPlacement } from './Popover'
import { kitIcon, type KitIcon } from './overlayCore'
import './overlays.css'

export interface MenuItem {
  key: string
  label: ReactNode
  /** Line under the label. */
  sub?: ReactNode
  /** Quieter third line (e.g. "Leave · 12 min ago"). */
  meta?: ReactNode
  /** Small leading icon: a design icon name or a node. */
  icon?: KitIcon
  /** Leading 38px round tile (initials, or an icon node). */
  avatar?: ReactNode
  onSelect?: () => void
  /** Renders the row as a link. */
  href?: string
  disabled?: boolean
  danger?: boolean
  /** Shows a tick (with `selection` the row is a radio / checkbox item). */
  checked?: boolean
  /** A small gold dot on the right, e.g. unread. */
  dot?: boolean
  /** Stay open after choosing this row (checkbox menus). */
  keepOpen?: boolean
}
export interface MenuSeparator { key: string; separator: true }
export interface MenuHeading { key: string; heading: ReactNode }
export type MenuEntry = MenuItem | MenuSeparator | MenuHeading

export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
}

export interface MenuProps {
  /** Accessible name of the menu, e.g. "Account". */
  label: string
  items: MenuEntry[]
  /** Renders the trigger; spread `props` onto your button (uncontrolled use). */
  trigger?: (args: { props: MenuTriggerProps; open: boolean }) => ReactNode
  /** Controlled use: open state, change callback and the element to hang from. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchorRef?: RefObject<HTMLElement | null>
  placement?: PopoverPlacement
  /** Width in px (default 280). */
  width?: number
  maxHeight?: number
  /** Title block at the top: a node, or { title, sub, aside }. */
  header?: ReactNode | { title: ReactNode; sub?: ReactNode; aside?: ReactNode }
  footer?: ReactNode
  /** Makes rows radio or checkbox items (uses `checked`). */
  selection?: 'radio' | 'checkbox'
  /** Shown when there are no rows. */
  emptyText?: ReactNode
}

const isItem = (e: MenuEntry): e is MenuItem => !('separator' in e) && !('heading' in e)
const enabledRows = (list: HTMLElement | null) =>
  Array.from(list?.querySelectorAll<HTMLElement>('[data-uko-item]:not([aria-disabled="true"])') ?? [])
const isHeaderObj = (h: MenuProps['header']): h is { title: ReactNode; sub?: ReactNode; aside?: ReactNode } =>
  !!h && typeof h === 'object' && !isValidElement(h) && 'title' in (h as object)

export function Menu({
  label, items, trigger, open: openProp, onOpenChange, anchorRef: anchorProp, placement = 'bottom-end', width = 280,
  maxHeight, header, footer, selection, emptyText,
}: MenuProps) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [own, setOwn] = useState(false)
  const openFrom = useRef<'first' | 'last'>('first')
  const open = openProp ?? own
  const anchorRef = anchorProp ?? triggerRef

  const setOpen = (v: boolean) => {
    if (openProp === undefined) setOwn(v)
    onOpenChange?.(v)
  }

  const rows = () => enabledRows(listRef.current)
  const focusAt = (i: number) => { const r = rows(); if (r.length) r[(i + r.length) % r.length].focus() }

  // On open, focus the first row (or the last when opened with ArrowUp). Next frame: the
  // popover is still invisible (being placed) during this commit, and invisible rows can't take focus.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const r = enabledRows(listRef.current)
      if (r.length) (openFrom.current === 'last' ? r[r.length - 1] : r[0]).focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const choose = (item: MenuItem) => {
    if (item.disabled) return
    item.onSelect?.()
    if (!item.keepOpen) { setOpen(false); anchorRef.current?.focus({ preventScroll: true }) }
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const r = rows()
    const at = r.indexOf(document.activeElement as HTMLElement)
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(at + 1); break
      case 'ArrowUp': e.preventDefault(); focusAt(at < 0 ? -1 : at - 1); break
      case 'Home': e.preventDefault(); focusAt(0); break
      case 'End': e.preventDefault(); focusAt(-1); break
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toLowerCase()
          const order = r.slice(at + 1).concat(r.slice(0, at + 1))
          const hit = order.find((el) => (el.textContent || '').trim().toLowerCase().startsWith(k))
          if (hit) { e.preventDefault(); hit.focus() }
        }
    }
  }

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => { openFrom.current = 'first'; setOpen(!open) },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openFrom.current = e.key === 'ArrowUp' ? 'last' : 'first'
        if (!open) setOpen(true)
        else focusAt(e.key === 'ArrowUp' ? -1 : 0)
      }
    },
  }

  const role = selection === 'radio' ? 'menuitemradio' : selection === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'
  const hasRows = items.some(isItem)

  return (
    <>
      {trigger?.({ props: triggerProps, open })}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement={placement}
        width={width}
        maxHeight={maxHeight}
        className="uko-menu-pop"
        initialFocus="none"
        onKeyDown={onMenuKey}
      >
        {header && (isHeaderObj(header)
          ? (
            <div className="uko-menu-head">
              <div className="uko-menu-headtext">
                <div className="uko-menu-title">{header.title}</div>
                {header.sub && <div className="uko-menu-headsub">{header.sub}</div>}
              </div>
              {header.aside}
            </div>
          )
          : <div className="uko-menu-head">{header}</div>)}
        <div ref={listRef} id={menuId} role="menu" aria-label={label} className="uko-menu">
          {items.map((entry) => {
            if ('separator' in entry) return <div key={entry.key} role="separator" className="uko-menu-sep" />
            if ('heading' in entry) return <div key={entry.key} role="presentation" className="uko-menu-heading">{entry.heading}</div>
            const content = (
              <>
                {entry.avatar != null
                  ? <span className="uko-menu-avatar" aria-hidden="true">{entry.avatar}</span>
                  : entry.icon ? <span className="uko-menu-icon" aria-hidden="true">{kitIcon(entry.icon, 18)}</span> : null}
                <span className="uko-menu-text">
                  <span className="uko-menu-label">{entry.label}</span>
                  {entry.sub && <span className="uko-menu-sub">{entry.sub}</span>}
                  {entry.meta && <span className="uko-menu-meta">{entry.meta}</span>}
                </span>
                {entry.dot && <span className="uko-menu-dot" aria-hidden="true" />}
                {entry.checked && <Check className="uko-menu-tick" size={18} strokeWidth={2.4} aria-hidden="true" />}
              </>
            )
            const common = {
              role,
              tabIndex: -1,
              'aria-disabled': entry.disabled || undefined,
              'aria-checked': selection ? !!entry.checked : undefined,
              'data-uko-item': '',
              'data-danger': entry.danger ? '' : undefined,
              className: 'uko-menu-item',
            }
            return entry.href && !entry.disabled
              ? <a key={entry.key} href={entry.href} {...common} onClick={() => choose(entry)}>{content}</a>
              : <button key={entry.key} type="button" {...common} onClick={() => choose(entry)}>{content}</button>
          })}
          {!hasRows && emptyText && <div className="uko-menu-empty">{emptyText}</div>}
        </div>
        {footer && <div className="uko-menu-foot">{footer}</div>}
      </Popover>
    </>
  )
}
