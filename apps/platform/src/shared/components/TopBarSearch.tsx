import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { SearchPill } from '@/design/kit/display'
import { SearchDialog, type SearchDialogProps } from '@/design/shell/search/SearchDialog'
import { useSearchStore } from '@/design/shell/search/searchStore'
import { canOpen } from '../navigation/access'
import { useAccessContext } from '../navigation/useAccess'
import { QUICK_ACTIONS } from '../search/actionRegistry'
import { searchHints } from '../search/searchModel'

/**
 * The top bar's search (design: HrmsPlatform header + UtSearch.dc.html).
 *
 *   • The pill shows "Search" and rolls through what this person can find (only what their
 *     permissions reach) and the ⌘ K keys. It opens the one search dialog.
 *   • ⌘K / Ctrl+K opens and closes the same dialog anywhere in the app; the phone's search icon
 *     opens it with `openSearch()` (design/shell/search/searchStore).
 *   • The dialog closes when the page changes.
 */
export interface TopBarSearchProps extends SearchDialogProps {
  /** Called when the dialog opens (the shell closes its other pop-ups). */
  onOpened?: () => void
}

export function TopBarSearch({ onOpen, onThisPage, onOpened }: TopBarSearchProps) {
  const open = useSearchStore((s) => s.open)
  const openSearch = useSearchStore((s) => s.openSearch)
  const toggle = useSearchStore((s) => s.toggleSearch)
  const close = useSearchStore((s) => s.closeSearch)
  const ctx = useAccessContext()
  const hints = useMemo(() => searchHints(ctx, QUICK_ACTIONS.some((a) => canOpen(a.access, ctx))), [ctx])
  const { pathname } = useLocation()

  // ⌘K / Ctrl+K toggles the dialog wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggle])

  const opened = useRef(onOpened)
  opened.current = onOpened
  useEffect(() => { if (open) opened.current?.() }, [open])

  // Moving to another page closes it.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    close()
  }, [pathname, close])
  // Never left open when the top bar goes (sign-out).
  useEffect(() => () => close(), [close])

  return (
    <>
      <SearchPill onOpen={() => openSearch()} hints={hints} className="ut-topbar__pill-search" />
      {open && <SearchDialog onOpen={onOpen} onThisPage={onThisPage} />}
    </>
  )
}
