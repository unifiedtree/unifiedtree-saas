import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { currentSubdomain } from '@/core/api/client'
import { useBrandingStore } from '@/core/tenant/workspaceBranding'
import { resolveWorkspaceHostOnce, type PublicBranding, type WorkspaceHostState } from '@/core/tenant/workspaceHost'
import '@/design/shell/shell.css'

/** UnifiedTree's website; only linked from pages that are not a business's own (white label). */
const WEBSITE_URL = 'https://www.unifiedtree.com'

/**
 * Mount above the session (AuthProvider). On a business address it waits for
 * the backend's answer (blank meanwhile, as the app already is while the
 * session resolves), then either runs the app as before or shows one of the
 * pages below instead of a sign-in. Off a business address it does nothing.
 */
export function WorkspaceHostGate({ children }: { children: React.ReactNode }) {
  const subdomain = useMemo(() => currentSubdomain(), [])
  const [state, setState] = useState<WorkspaceHostState>(subdomain ? { kind: 'checking' } : { kind: 'platform' })

  useEffect(() => {
    if (!subdomain) return
    let live = true
    void resolveWorkspaceHostOnce(subdomain).then((s) => {
      if (!live) return
      // The sign-in page reads the same answer for the name and logo; don't ask again.
      if (s.kind === 'open') useBrandingStore.getState().apply(`pub:${subdomain}`, s.branding)
      setState(s)
    })
    return () => { live = false }
  }, [subdomain])

  if (state.kind === 'checking') return null
  if (state.kind === 'not_found' || state.kind === 'reserved' || state.kind === 'unavailable') {
    return <WorkspaceHostPage state={state} host={window.location.hostname} />
  }
  return <>{children}</>
}

type PageState =
  | { kind: 'not_found' }
  | { kind: 'reserved' }
  | { kind: 'unavailable'; branding: PublicBranding }

/** What is shown instead of a sign-in on an address that has no open business. */
export function WorkspaceHostPage({ state, host }: { state: PageState; host: string }) {
  const title = state.kind === 'not_found' ? 'This workspace doesn’t exist'
    : state.kind === 'reserved' ? 'There’s no business here'
    : 'This workspace isn’t available'

  useEffect(() => { document.title = title }, [title])

  return (
    <main className="ut-noaccess" data-workspace-host={state.kind}>
      <section className="ut-noaccess__card" aria-labelledby="ut-host-title">
        <span className="ut-noaccess__icon" aria-hidden="true">
          {dashIcon(state.kind === 'unavailable' ? 'lock' : state.kind === 'reserved' ? 'globe' : 'search', 26)}
        </span>
        <h1 id="ut-host-title" className="ut-noaccess__title">{title}</h1>
        {state.kind === 'not_found' && (
          <>
            <p className="ut-noaccess__text">
              No business uses <strong>{host}</strong>. Check the address with your administrator.
            </p>
            <Button variant="primary" size={40} href={WEBSITE_URL}>Go to unifiedtree.com</Button>
            <p className="ut-noaccess__text" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Own a business on UnifiedTree? <a href={`${WEBSITE_URL}/login`} style={{ color: 'var(--u-brt, #0F6E56)', fontWeight: 500 }}>Sign in</a> to see its address.
            </p>
          </>
        )}
        {state.kind === 'reserved' && (
          <>
            <p className="ut-noaccess__text">
              <strong>{host}</strong> belongs to UnifiedTree and isn’t a business workspace. Sign in at your business’s own address, like yourbusiness.unifiedtree.com.
            </p>
            <Button variant="primary" size={40} href={WEBSITE_URL}>Go to unifiedtree.com</Button>
          </>
        )}
        {state.kind === 'unavailable' && (
          // A business's own address: white label, so no vendor name or links here.
          <p className="ut-noaccess__text">
            {state.branding.workspaceName ? <><strong>{state.branding.workspaceName}</strong> can’t be signed in to right now.</> : 'This workspace can’t be signed in to right now.'}{' '}
            If you work here, contact your administrator.
          </p>
        )}
      </section>
    </main>
  )
}
