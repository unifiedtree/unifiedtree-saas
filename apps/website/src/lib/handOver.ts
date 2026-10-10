/**
 * Where to send someone whose business session was just started here (sign-up, "Open your business",
 * mobile sign-in). On a *.unifiedtree.com business the session is NOT put in the address (review 7 Oct:
 * a token in the URL lands in history, logs and Referer): the API already set the business's httpOnly
 * refresh cookie on .unifiedtree.com, and the business app signs in from it on load. Elsewhere — local
 * dev on *.localhost, where that cookie can't reach — the token still travels as ?token=.
 */
export function handOverUrl(base: string, token: string): string {
  const b = base.replace(/\/$/, '')
  let host = ''
  try {
    host = new URL(b).hostname.toLowerCase()
  } catch {
    /* not a full address: keep the token */
  }
  // Straight onto the business's Apps page (owner, 10 Oct 2026).
  if (host.endsWith('.unifiedtree.com')) return `${b}/modules`
  return `${b}/?token=${encodeURIComponent(token)}`
}

/**
 * A business's own address: in local dev (this site on localhost or 127.0.0.1) the business's web app on
 * <sub>.localhost:3001, otherwise its workspaceUrl, else <sub>.unifiedtree.com.
 */
export function businessBase(workspace: { subdomain: string; workspaceUrl?: string | null }, pageHost: string): string {
  return pageHost === 'localhost' || pageHost === '127.0.0.1'
    ? `http://${workspace.subdomain}.localhost:3001`
    : (workspace.workspaceUrl || `https://${workspace.subdomain}.unifiedtree.com`)
}

/** The business's own sign-in page: the person signs in there, so no token goes with them. */
export function businessSignInUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/login`
}

/**
 * The answer to "Enter" (POST /v1/accounts/workspaces/session with silent: true) for a login that needs a
 * two-factor code: the business's own sign-in page asks for it, so the person is sent there instead of told.
 */
export function needsTwoFactorSignIn(status: number, data: unknown): boolean {
  return status === 403 && !!data && typeof data === 'object'
    && (data as { errorCode?: unknown }).errorCode === 'USE_PASSWORD_FOR_TWO_FACTOR'
}
