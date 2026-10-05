// Lazy pages that can be fetched before they're opened.
//
// Every page is code-split (App.tsx). Without preloading, the first click on a
// page waits for its chunk (and, in dev, for Vite to compile it) — the shell
// sat there looking frozen. lazyPage() keeps each page's loader, the route
// table is registered once, and preloadPath() fetches the chunk for any URL.
// The shell preloads what the signed-in person can reach from the sidebar and
// the current section's tabs when the browser is idle, and on hover/focus, so
// by the time they click the code is already there.
import React from 'react'
import { matchRoutes, type RouteObject } from 'react-router-dom'

type Loader = () => Promise<{ default: React.ComponentType<any> }>
type Preloadable = React.LazyExoticComponent<React.ComponentType<any>> & { preload?: Loader }

/**
 * A page's code file that the server no longer has. After a deploy, a tab that was opened before it
 * still asks for the old build's file the first time it opens a page; the host answers with index.html,
 * so the browser refuses it ("Failed to fetch dynamically imported module" in Chrome and Edge).
 */
export function isStaleChunkError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message)
}

const STALE_RELOAD_KEY = 'ut.staleChunkReloadAt'

/**
 * Loads the new build once instead of showing the error page. A second failure within a minute is a
 * real error (the page's error boundary shows it), so this can never reload in a loop.
 */
function reloadForNewBuild(error: unknown): boolean {
  if (!isStaleChunkError(error)) return false
  // Offline, the download fails the same way: keep the app and its error screen rather than the browser's offline page.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    if (Date.now() - Number(sessionStorage.getItem(STALE_RELOAD_KEY) || 0) < 60_000) return false
    sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function lazyPage(load: Loader): Preloadable {
  // Only opening the page reloads; a background preload that fails just tries again later (preloadPath).
  const C = React.lazy(() => load().catch((error: unknown) => {
    if (reloadForNewBuild(error)) return new Promise<never>(() => {})  // the page's loading outline stays up
    throw error
  })) as Preloadable
  C.preload = load
  return C
}

let routes: RouteObject[] = []
/** App.tsx registers its route table once (createRoutesFromChildren of its <Routes>). */
export function registerRoutes(r: RouteObject[]) { routes = r }

/** The page component's loader inside a route element (it sits under RouteGuard / ModuleGate wrappers). */
function findLoader(node: unknown, depth = 0): Loader | null {
  if (!node || depth > 8 || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const n of node) { const f = findLoader(n, depth + 1); if (f) return f } return null }
  const el = node as { type?: { preload?: Loader }; props?: { children?: unknown; element?: unknown } }
  if (el.type && typeof el.type === 'object' && typeof el.type.preload === 'function') return el.type.preload
  return findLoader(el.props?.children, depth + 1) || findLoader(el.props?.element, depth + 1)
}

const started = new Set<Loader>()
/** Fetch the code for the page at `path` (a no-op once fetched, or for unknown paths). */
export function preloadPath(path: string) {
  if (!routes.length) return
  const matches = matchRoutes(routes, path.split('?')[0]) || []
  for (const m of matches) {
    const load = findLoader(m.route.element)
    if (load && !started.has(load)) { started.add(load); load().catch(() => started.delete(load)) }
  }
}

const idle = (fn: () => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200))
/** Preload several paths, one per idle slot, so it never competes with the page being used. */
export function preloadPathsWhenIdle(paths: string[]) {
  const queue = [...new Set(paths)]
  const next = () => { const p = queue.shift(); if (!p) return; preloadPath(p); idle(next) }
  idle(next)
}
