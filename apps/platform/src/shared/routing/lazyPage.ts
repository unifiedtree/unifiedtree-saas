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

export function lazyPage(load: Loader): Preloadable {
  const C = React.lazy(load) as Preloadable
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
