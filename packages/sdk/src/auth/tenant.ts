const RESERVED = new Set([
  'api', 'admin', 'www', 'app', 'auth', 'cdn',
  'status', 'docs', 'help', 'mail', 'unifiedtree',
]);

/**
 * Resolves the tenant slug from the current window.location.host.
 * Returns null if the host is a reserved subdomain or has no subdomain.
 *
 * Examples:
 *   acme.unifiedtree.com   → "acme"
 *   acme.lvh.me:3001       → "acme"
 *   localhost:3001         → null
 *   api.unifiedtree.com    → null  (reserved)
 */
export function resolveTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;

  const host = window.location.hostname.toLowerCase();

  // Strip port
  const parts = host.split('.');

  // Need at least 2 parts (subdomain.domain)
  if (parts.length < 2) return null;

  const subdomain = parts[0];

  // localhost or IP-only
  if (subdomain === 'localhost' || /^\d+$/.test(subdomain)) return null;

  if (RESERVED.has(subdomain)) return null;

  return subdomain;
}

/**
 * Builds a full URL for the given tenant slug and path.
 * Preserves the current protocol and port.
 */
export function tenantUrl(slug: string, path = ''): string {
  if (typeof window === 'undefined') return path;

  const { protocol, host } = window.location;
  const parts = host.split('.');

  // Replace existing subdomain or prepend
  const base = parts.length >= 2 ? parts.slice(1).join('.') : host;

  return `${protocol}//${slug}.${base}${path}`;
}
