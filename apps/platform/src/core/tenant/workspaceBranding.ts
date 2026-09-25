// White-label branding for the workspace (Settings → Branding).
//
// The client's rule: people inside a customer's workspace never see the
// vendor's name or logo. Every surface that used to show it (rail, mobile
// header, splash, sign-in page, browser tab, favicon) reads this one store:
//   * workspaceName: the workspace (company) display name
//   * markUrl:       the square mark, if uploaded
//   * logoUrl:       the wide logo, if uploaded
//   * monogram:      the first letter of the name, drawn when neither exists
//
// Signed in, it reads GET /v1/workspace/branding (tenant from the JWT).
// Signed out on <workspace>.<host> (sign-in, reset password, invite), it
// reads the public GET /v1/public/workspace-branding (name and images only).
// On a host that is not a workspace (the bare platform host), there is no
// workspace and the platform's own branding stays.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, API_BASE_URL, currentSubdomain } from '@/core/api/client'

export interface BrandingDto {
  workspaceName: string | null
  monogram?: string | null
  logoUrl: string | null
  markUrl: string | null
  logoWidth?: number | null
  logoHeight?: number | null
  markWidth?: number | null
  markHeight?: number | null
  updatedAt?: string | null
}

export interface WorkspaceBranding {
  /** False on a host that isn't a workspace (platform-level pages). */
  isWorkspace: boolean
  workspaceName: string | null
  monogram: string
  logoUrl: string | null
  markUrl: string | null
  logoSize: { w: number; h: number } | null
  markSize: { w: number; h: number } | null
  loaded: boolean
}

/** The server returns image paths relative to the API root; make them loadable. */
export function resolveAssetUrl(u?: string | null): string | null {
  if (!u) return null
  if (u.startsWith('/v1/')) return `${API_BASE_URL}${u}`
  if (u.startsWith('https://') || u.startsWith('http://') || u.startsWith('data:') || u.startsWith('blob:')) return u
  return null
}

/** First letter (or digit) of the workspace name, upper-cased. */
export function monogramOf(name?: string | null): string {
  const m = (name ?? '').trim().match(/[\p{L}\p{N}]/u)
  return m ? m[0].toLocaleUpperCase() : ''
}

interface State {
  key: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: BrandingDto | null
  pageTitle: string | null
  apply: (key: string, dto: BrandingDto) => void
  load: (key: string, authed: boolean, force?: boolean) => Promise<void>
  setPageTitle: (t: string | null) => void
}

export const useBrandingStore = create<State>()((set, get) => ({
  key: null,
  status: 'idle',
  data: null,
  pageTitle: null,
  apply: (key, dto) => set({ key, status: 'ready', data: dto }),
  setPageTitle: (t) => { if (get().pageTitle !== t) set({ pageTitle: t }) },
  load: async (key, authed, force = false) => {
    const s = get()
    if (!force && s.key === key && (s.status === 'loading' || s.status === 'ready')) return
    // Keep showing the previous data for the same workspace while reloading.
    set({ key, status: 'loading', data: s.key === key ? s.data : null })
    try {
      const dto = authed
        ? await apiJson<BrandingDto>('/v1/workspace/branding')
        : await apiJson<BrandingDto>('/v1/public/workspace-branding')
      if (get().key === key) set({ status: 'ready', data: dto })
    } catch {
      if (get().key === key) set({ status: 'error' })
    }
  },
}))

/** Force a re-read (after an upload or removal in Settings). */
export function reloadWorkspaceBranding() {
  const s = useBrandingStore.getState()
  if (s.key) void s.load(s.key, s.key.startsWith('auth:'), true)
}

/**
 * The workspace's branding. Mount anywhere; the first caller for a given
 * session/workspace triggers the fetch, the rest share it.
 */
export function useWorkspaceBranding(): WorkspaceBranding {
  const sdkStatus = useSdkStore((s) => s.status)
  const sdkTenant = useSdkStore((s) => s.tenant)
  const subdomain = currentSubdomain()
  const authed = sdkStatus === 'authenticated' && !!sdkTenant
  const key = authed ? `auth:${sdkTenant!.id}` : subdomain ? `pub:${subdomain}` : null
  const storeKey = useBrandingStore((s) => s.key)
  const status = useBrandingStore((s) => s.status)
  const data = useBrandingStore((s) => s.data)
  const load = useBrandingStore((s) => s.load)

  useEffect(() => {
    // Wait for the session to resolve so a signed-in reload doesn't fetch twice.
    if (!key || sdkStatus === 'idle' || sdkStatus === 'loading') return
    void load(key, authed)
  }, [key, authed, sdkStatus, load])

  const current = storeKey === key ? data : null
  const name = current?.workspaceName || (authed ? sdkTenant?.displayName : null) || null
  const isWorkspace = authed || !!subdomain
  return {
    isWorkspace,
    workspaceName: name,
    monogram: monogramOf(name) || (isWorkspace ? '' : 'U'),
    logoUrl: resolveAssetUrl(current?.logoUrl),
    markUrl: resolveAssetUrl(current?.markUrl),
    logoSize: current?.logoWidth && current?.logoHeight ? { w: current.logoWidth, h: current.logoHeight } : null,
    markSize: current?.markWidth && current?.markHeight ? { w: current.markWidth, h: current.markHeight } : null,
    loaded: storeKey === key && (status === 'ready' || status === 'error'),
  }
}

/** Register the current page's name for the browser tab ("<Page> - <Workspace>"). */
export function usePageTitle(title: string | null) {
  const setPageTitle = useBrandingStore((s) => s.setPageTitle)
  useEffect(() => {
    setPageTitle(title)
  }, [title, setPageTitle])
}

/** Escape a string for use inside SVG text. */
function xmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A favicon for a workspace with no uploaded image: its monogram, white on
 * the rail's dark green (#0c5a45), the same colours the app chrome uses.
 */
export function monogramFaviconUrl(letter: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0c5a45"/>`
    + `<text x="32" y="45" text-anchor="middle" font-family="'Plus Jakarta Sans',Inter,Arial,sans-serif" font-size="38" font-weight="800" fill="#ffffff">${xmlEscape(letter || '')}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function setIcon(rel: string, href: string, type?: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-branding]`)
  if (!el) {
    // Drop the static icons from index.html so the browser can't pick them instead.
    document.head.querySelectorAll(`link[rel="${rel}"]:not([data-branding])`).forEach((n) => n.remove())
    el = document.createElement('link')
    el.rel = rel
    el.setAttribute('data-branding', '1')
    document.head.appendChild(el)
  }
  if (type) el.type = type
  else el.removeAttribute('type')
  if (el.href !== href) el.href = href
}

/**
 * Keeps the browser tab in step with the workspace: title "<Page> - <Workspace>"
 * and the workspace's mark (or logo, or a monogram) as the favicon. Mount once,
 * at the app root. On a host that isn't a workspace, the platform's own title
 * and icon stay.
 */
export function useBrandingHead() {
  const b = useWorkspaceBranding()
  const pageTitle = useBrandingStore((s) => s.pageTitle)

  useEffect(() => {
    if (!b.isWorkspace) {
      document.title = pageTitle ? `${pageTitle} - UnifiedTree` : 'UnifiedTree'
      return
    }
    const parts = [pageTitle, b.workspaceName].filter(Boolean) as string[]
    document.title = parts.length ? parts.join(' - ') : 'Sign in'
  }, [b.isWorkspace, b.workspaceName, pageTitle])

  useEffect(() => {
    if (!b.isWorkspace) {
      setIcon('icon', '/favicon.svg?v=4', 'image/svg+xml')
      setIcon('apple-touch-icon', '/icon.png?v=4')
      return
    }
    // Before the name is known, keep index.html's neutral icon.
    if (!b.loaded && !b.workspaceName) return
    const img = b.markUrl || b.logoUrl
    const href = img || monogramFaviconUrl(b.monogram)
    setIcon('icon', href, img ? undefined : 'image/svg+xml')
    setIcon('apple-touch-icon', img || monogramFaviconUrl(b.monogram))
  }, [b.isWorkspace, b.loaded, b.workspaceName, b.markUrl, b.logoUrl, b.monogram])
}
