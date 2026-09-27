// The design's searchable dropdown (PgCompanies company switcher): a trigger (a 44px field, or
// the 66px "rich" switcher with monogram, eyebrow, name and "Switch"), then a popover with a
// search box and result count, rich rows (tile, name, sub-line, tick on the chosen one), an
// empty line and an optional footer action ("Add company").
// Keyboard: the search box drives the list (Arrow keys, Enter); Escape closes and returns to
// the trigger. The rows and their values come from the caller — the dropdown holds no data.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, type PopoverPlacement } from './Popover'
import { kitIcon, type KitIcon } from './overlayCore'
import './overlays.css'

export interface DropdownOption<V extends string = string> {
  value: V
  label: string
  /** Second line, e.g. "IT Services · 3 branches · 30 people". */
  sub?: ReactNode
  /** Letters for a coloured tile (38px in rows, 44px in the rich trigger), e.g. "DT". */
  monogram?: string
  /** Tile colour (a CSS colour, ideally a var(--u-*)); default brand. */
  tone?: string
  /** Any other leading node (used when there's no monogram). */
  leading?: ReactNode
  /** Extra words the search should match. */
  keywords?: string
  disabled?: boolean
}

export interface DropdownProps<V extends string = string> {
  options: DropdownOption<V>[]
  value: V | null | undefined
  onChange: (value: V, option: DropdownOption<V>) => void
  /** Accessible name, e.g. "Company". */
  label: string
  /** 'field' = 44px select-like box (default); 'rich' = the 66px company switcher. */
  variant?: 'field' | 'rich'
  placeholder?: string
  /** Rich trigger: the small caps line above the name, e.g. (i, n) => `Company ${i} of ${n}`. */
  eyebrow?: ReactNode | ((position: number, total: number) => ReactNode)
  /** Rich trigger: quiet word before the chevron, e.g. "Switch". */
  hint?: ReactNode
  searchable?: boolean
  searchPlaceholder?: string
  /** Text next to the search box. Default: "3 total", or "2 of 3" while searching. */
  countLabel?: (shown: number, total: number, query: string) => ReactNode
  emptyText?: ReactNode
  /** An action row under the list, e.g. { label: 'Add company', icon: 'plus', onClick }. */
  footerAction?: { label: ReactNode; icon?: KitIcon; onClick: () => void }
  disabled?: boolean
  invalid?: boolean
  /** id of the trigger button (for an outside <label htmlFor>). */
  id?: string
  className?: string
  /** Popover width: 'anchor' (default) or px. */
  menuWidth?: number | 'anchor'
  placement?: PopoverPlacement
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Options whose name, string sub-line or keywords contain the query (case and accent blind). */
export function filterOptions<V extends string>(options: DropdownOption<V>[], query: string): DropdownOption<V>[] {
  const q = norm(query.trim())
  if (!q) return options
  return options.filter((o) => norm(`${o.label} ${typeof o.sub === 'string' ? o.sub : ''} ${o.keywords ?? ''}`).includes(q))
}

/** Index of the first enabled option from `from`, walking in `dir` and wrapping; -1 if none. */
function firstEnabled<V extends string>(list: DropdownOption<V>[], from = 0, dir = 1): number {
  const n = list.length
  for (let k = 0, i = ((from % n) + n) % n; k < n; k++, i = (i + dir + n) % n) if (!list[i].disabled) return i
  return -1
}

function Tile({ option, size }: { option: DropdownOption<string>; size: 38 | 44 }) {
  if (option.monogram) {
    return (
      <span className="uko-dd-tile" data-size={size} style={option.tone ? { background: option.tone } : undefined} aria-hidden="true">
        {option.monogram}
      </span>
    )
  }
  return option.leading ? <span className="uko-dd-lead" aria-hidden="true">{option.leading}</span> : null
}

export function Dropdown<V extends string = string>({
  options, value, onChange, label, variant = 'field', placeholder = 'Select…', eyebrow, hint, searchable = true,
  searchPlaceholder = 'Search…', countLabel, emptyText = 'Nothing matches that search.', footerAction, disabled, invalid,
  id, className, menuWidth = 'anchor', placement = 'bottom-start',
}: DropdownProps<V>) {
  const uid = useId()
  const triggerId = id || `${uid}-trigger`
  const listId = `${uid}-list`, labelId = `${uid}-label`, valueId = `${uid}-value`
  const optId = (i: number) => `${uid}-opt-${i}`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const shown = useMemo(() => filterOptions(options, query), [options, query])

  const openList = () => {
    if (disabled) return
    setQuery('')
    setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled(options))
    setOpen(true)
  }
  const closeList = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }
  const pick = (i: number) => {
    const o = shown[i]
    if (!o || o.disabled) return
    closeList(true)
    if (o.value !== value) onChange(o.value, o)
  }

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optId(active))}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active]) // eslint-disable-line react-hooks/exhaustive-deps

  const onListKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const n = shown.length
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (n) setActive((a) => firstEnabled(shown, a < 0 ? 0 : (a + 1) % n)); break
      case 'ArrowUp': e.preventDefault(); if (n) setActive((a) => firstEnabled(shown, a < 0 ? n - 1 : (a - 1 + n) % n, -1)); break
      case 'Enter': e.preventDefault(); if (active >= 0) pick(active); break
      case 'Home': if (e.currentTarget === listRef.current) { e.preventDefault(); setActive(firstEnabled(shown)) } break
      case 'End': if (e.currentTarget === listRef.current) { e.preventDefault(); setActive(firstEnabled(shown, n - 1, -1)) } break
    }
  }

  const count = countLabel ? countLabel(shown.length, options.length, query) : query.trim() ? `${shown.length} of ${options.length}` : `${options.length} total`
  const eyebrowNode = typeof eyebrow === 'function' ? eyebrow(selectedIndex + 1, options.length) : eyebrow
  const activeId = open && active >= 0 && active < shown.length ? optId(active) : undefined

  return (
    <div className={['uko-dd', className].filter(Boolean).join(' ')} data-variant={variant}>
      <span id={labelId} className="uko-sr">{label}</span>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="uko-dd-trigger"
        data-variant={variant}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openList() } }}
      >
        {variant === 'rich' ? (
          <>
            {selected && <Tile option={selected} size={44} />}
            <span className="uko-dd-richtext">
              {eyebrowNode != null && <span className="uko-dd-eyebrow">{eyebrowNode}</span>}
              <span id={valueId} className="uko-dd-name">{selected?.label ?? placeholder}</span>
            </span>
            {hint && <span className="uko-dd-hint">{hint}</span>}
          </>
        ) : (
          <span id={valueId} className="uko-dd-value" data-empty={selected ? undefined : ''}>{selected?.label ?? placeholder}</span>
        )}
        <ChevronDown className="uko-dd-chev" size={18} aria-hidden="true" />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        placement={placement}
        width={menuWidth}
        className="uko-dd-pop"
        initialFocus={searchable ? inputRef : listRef}
      >
        {searchable && (
          <label className="uko-dd-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder={searchPlaceholder}
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); setActive(firstEnabled(filterOptions(options, e.target.value))) }}
              onKeyDown={onListKey}
            />
            <span className="uko-dd-count" aria-live="polite">{count}</span>
          </label>
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={searchable ? undefined : activeId}
          tabIndex={searchable ? undefined : -1}
          className="uko-dd-list"
          onKeyDown={searchable ? undefined : onListKey}
        >
          {shown.map((o, i) => {
            const isSel = o.value === value
            return (
              <div
                key={o.value}
                id={optId(i)}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                data-active={i === active ? '' : undefined}
                className="uko-dd-option"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(i)}
              >
                <Tile option={o} size={38} />
                <span className="uko-dd-otext">
                  <span className="uko-dd-otitle">{o.label}</span>
                  {o.sub != null && <span className="uko-dd-osub">{o.sub}</span>}
                </span>
                {isSel && <Check className="uko-dd-tick" size={18} strokeWidth={2.4} aria-hidden="true" />}
              </div>
            )
          })}
          {!shown.length && <div className="uko-dd-empty" role="presentation">{emptyText}</div>}
        </div>
        {footerAction && (
          <button type="button" className="uko-dd-foot" onClick={() => { closeList(false); footerAction.onClick() }}>
            {kitIcon(footerAction.icon ?? 'plus', 16)}
            {footerAction.label}
          </button>
        )}
      </Popover>
    </div>
  )
}
