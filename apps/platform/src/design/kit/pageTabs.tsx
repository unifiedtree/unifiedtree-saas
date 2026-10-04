// The page header's tab slot: how a page's sub-section tabs (PillTabs) find the
// page header (PageHeader) they sit under, so the two draw as one card — the
// Master "Organization Setup" look: a white hero card (eyebrow, title, summary,
// actions) with the tabs inside it as a segmented control — without any wiring
// in the page.
//
//   PageFrame / ModulePage  → host the slot (PageTabsHost)
//   PageHeader              → registers its slot element and turns into the hero card
//                             once a bar has claimed the slot
//   PillTabs                → the first bar in the page claims the slot
//                             (placement="auto") and renders into it through a portal
//
// A page without a host (no PageFrame / ModulePage), or a header-less page, keeps
// today's look: plain header, tabs where they stand. Server rendering and the
// static-markup tests never claim (no layout effects), so their output is unchanged.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface PageTabsSlot {
  /** The header's slot element, once the header is on screen. */
  el: HTMLElement | null
  /** Set by PageHeader (a stable ref callback). */
  setEl: (el: HTMLElement | null) => void
  /** Id of the tab bar that owns the slot (null = none yet). */
  owner: string | null
  /** Takes the slot for `id`; false when another bar already has it. Stable. */
  claim: (id: string) => boolean
  /** Gives the slot back (no-op unless `id` owns it). Stable. */
  release: (id: string) => void
}

const Ctx = createContext<PageTabsSlot | null>(null)

/** The page's tab slot, or null outside a host (PageFrame / ModulePage). */
export function usePageTabsSlot(): PageTabsSlot | null {
  return useContext(Ctx)
}

/** Hosts the slot for one page. PageFrame and ModulePage render it; a page with its own frame can too. */
export function PageTabsHost({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const ownerRef = useRef<string | null>(null)
  const claim = useCallback((id: string) => {
    if (ownerRef.current != null && ownerRef.current !== id) return false
    ownerRef.current = id
    setOwner(id)
    return true
  }, [])
  const release = useCallback((id: string) => {
    if (ownerRef.current !== id) return
    ownerRef.current = null
    setOwner(null)
  }, [])
  const value = useMemo<PageTabsSlot>(() => ({ el, setEl, owner, claim, release }), [el, owner, claim, release])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Bars rendered inside here never claim a slot (PageHeader wraps its explicit `tabs` in it). */
export function PageTabsInline({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={null}>{children}</Ctx.Provider>
}
