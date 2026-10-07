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
  if (host.endsWith('.unifiedtree.com')) return `${b}/`
  return `${b}/?token=${encodeURIComponent(token)}`
}
