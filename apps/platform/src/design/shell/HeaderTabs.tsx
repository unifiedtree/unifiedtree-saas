// The top bar's page tabs (SHELL CONTRACT 1, REDESIGN_RULES.md):
//
//   import { HeaderTabs } from '@/design/shell/HeaderTabs'
//   <HeaderTabs label="Leave views" items={[{ key, label, count?, urgent? }]} active={view} onChange={setView} />
//
// It renders the design's outlined pill tabs (kit PillTabs) inside the shell's TOP BAR, through a portal
// into the header slot. Without a slot (a unit test, a page shown outside the shell) it renders inline,
// where it stands. The slot holds ONE bar: the first mounted bar takes it; any other renders inline (a
// nested bar stays in the page). When no page publishes a bar, the shell shows the page's name as one
// solid pill.
//
// Semantics stay as today:
//   'views' (default) role="group" aria-label={label} + buttons with aria-pressed (ModuleKit Views)
//   'tabs'            role="tablist" + role="tab" + aria-selected
// Counts and urgent counts stay, inside the button, so its accessible name reads as before.
//
// HeaderSections is the dashboard's variant: section pills with icons that jump to a section
// (<nav> + aria-current="location"), in the same slot.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PillTabs, type PillTab } from '@/design/kit/display'

export interface HeaderTabItem { key: string; label: string; count?: number; urgent?: boolean }

export interface HeaderTabsProps {
  /** Accessible name of the bar, e.g. "Leave views". */
  label: string
  items: HeaderTabItem[]
  active: string
  onChange: (key: string) => void
  semantics?: 'views' | 'tabs'
}

export interface HeaderSectionItem { key: string; label: string; /** Design icon name (design/dc/icons). */ icon?: string }

export interface HeaderSectionsProps {
  /** Accessible name, e.g. "Dashboard sections". */
  label: string
  items: HeaderSectionItem[]
  active: string
  onSelect: (key: string) => void
}

// ── The slot. The shell provides it; pages only use HeaderTabs / HeaderSections. ──────────────────

interface SlotControl {
  claim: (id: string) => boolean
  release: (id: string) => void
  setEl: (el: HTMLElement | null) => void
}
interface SlotState {
  /** The top bar's slot element, once mounted. */
  el: HTMLElement | null
  /** The bar that holds the slot. */
  owner: string | null
}

const SlotControlContext = createContext<SlotControl | null>(null)
const SlotStateContext = createContext<SlotState | null>(null)

// Layout effect in the browser (no flash of an inline bar), plain effect elsewhere.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Wraps the shell: pages under it can publish one bar into the top bar's slot. */
export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const ownerRef = useRef<string | null>(null)
  const claim = useCallback((id: string) => {
    if (ownerRef.current && ownerRef.current !== id) return false
    ownerRef.current = id
    setOwner(id)
    return true
  }, [])
  const release = useCallback((id: string) => {
    if (ownerRef.current !== id) return
    ownerRef.current = null
    setOwner(null)
  }, [])
  const control = useMemo<SlotControl>(() => ({ claim, release, setEl }), [claim, release])
  const state = useMemo<SlotState>(() => ({ el, owner }), [el, owner])
  return (
    <SlotControlContext.Provider value={control}>
      <SlotStateContext.Provider value={state}>{children}</SlotStateContext.Provider>
    </SlotControlContext.Provider>
  )
}

/** For the top bar: the ref callback for its slot element, and whether a page has published a bar. */
export function useHeaderSlotHost(): { slotRef: (el: HTMLElement | null) => void; hasBar: boolean } {
  const control = useContext(SlotControlContext)
  const state = useContext(SlotStateContext)
  const setEl = control?.setEl
  const slotRef = useCallback((el: HTMLElement | null) => { setEl?.(el) }, [setEl])
  return { slotRef, hasBar: !!state?.owner }
}

type Placement = { mode: 'inline' } | { mode: 'slot'; el: HTMLElement } | { mode: 'wait' }

/** Holds the slot while mounted (when it is free) and says where to render the bar. */
function useSlotPlacement(): Placement {
  const control = useContext(SlotControlContext)
  const state = useContext(SlotStateContext)
  const id = useId()
  const [held, setHeld] = useState(false)
  const free = !!state && (state.owner === null || state.owner === id)
  useIsoLayoutEffect(() => {
    if (!control || !free) return
    if (!control.claim(id)) return
    setHeld(true)
    return () => { control.release(id); setHeld(false) }
  }, [control, free, id])
  if (!control || !state) return { mode: 'inline' }
  if (held && state.owner === id) return state.el ? { mode: 'slot', el: state.el } : { mode: 'wait' }
  return free ? { mode: 'wait' } : { mode: 'inline' }
}

function countBadge(t: HeaderTabItem, on: boolean) {
  if (t.count == null || t.count === 0) return null
  return <span className={['ut-htab-n', on ? 'is-on' : t.urgent ? 'is-urgent' : ''].filter(Boolean).join(' ')}>{t.count}</span>
}

export function HeaderTabs({ label, items, active, onChange, semantics = 'views' }: HeaderTabsProps) {
  const place = useSlotPlacement()
  if (place.mode === 'wait') return null
  const pills: PillTab[] = items.map((t) => ({ key: t.key, label: <><span>{t.label}</span>{countBadge(t, t.key === active)}</> }))
  const bar = (
    <PillTabs items={pills} activeKey={active} onSelect={(k) => onChange(k)} label={label}
      semantics={semantics === 'tabs' ? 'tabs' : 'toggle'} className={place.mode === 'slot' ? 'ut-htabs' : 'ut-htabs ut-htabs--inline'} />
  )
  return place.mode === 'slot' ? createPortal(bar, place.el) : bar
}

export function HeaderSections({ label, items, active, onSelect }: HeaderSectionsProps) {
  const place = useSlotPlacement()
  if (place.mode === 'wait') return null
  const pills: PillTab[] = items.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))
  const bar = (
    <PillTabs items={pills} activeKey={active} onSelect={(k) => onSelect(k)} label={label} semantics="nav" current="location"
      className={place.mode === 'slot' ? 'ut-htabs' : 'ut-htabs ut-htabs--inline'} />
  )
  return place.mode === 'slot' ? createPortal(bar, place.el) : bar
}
