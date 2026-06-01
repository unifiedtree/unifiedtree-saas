const DEFAULT_BASE_DOMAIN = 'unifiedtree.com'

/**
 * Extract the subdomain from a hostname
 * e.g. "acme.unifiedtree.com" → "acme"
 */
export function getSubdomainFromUrl(url?: string): string | null {
  try {
    const hostname = url
      ? new URL(url).hostname
      : typeof window !== 'undefined'
      ? window.location.hostname
      : ''

    const parts = hostname.split('.')
    // Expect subdomain.domain.tld — needs at least 3 parts
    if (parts.length < 3) return null
    const subdomain = parts[0]
    // Filter out 'www' and 'app' as they are not tenant subdomains
    if (subdomain === 'www' || subdomain === 'app') return null
    return subdomain
  } catch {
    return null
  }
}

/**
 * Build a workspace URL from a subdomain
 */
export function buildWorkspaceUrl(subdomain: string, baseDomain = DEFAULT_BASE_DOMAIN): string {
  return `https://${subdomain}.${baseDomain}`
}

/**
 * Validate a subdomain: lowercase alphanumeric + hyphens, 3–50 chars,
 * cannot start or end with hyphen
 */
export function isValidSubdomain(sub: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(sub)
}

/**
 * Generate a URL-safe subdomain from a company name
 * "TechCorp Inc." → "techcorp"
 */
export function generateSubdomain(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // remove special chars
    .trim()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '')          // trim leading/trailing hyphens
    .slice(0, 50)                   // max length
}

/**
 * Extract tenant ID from a custom request header (server-side use)
 */
export function extractTenantFromHeader(headers: Headers): string | null {
  return headers.get('x-tenant-id')
}

/**
 * Build an API URL scoped to a tenant
 */
export function buildApiUrl(tenantId: string, path: string, baseApiUrl?: string): string {
  const base =
    baseApiUrl ??
    (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_API_URL'] : '') ??
    ''
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}/api/v1/tenants/${tenantId}${normalizedPath}`
}

/**
 * Parse tenant context from a web request object.
 */
export function parseTenantFromRequest(request: {
  headers: { get: (key: string) => string | null }
  url: string
}): { tenantId: string | null; subdomain: string | null } {
  const tenantId = request.headers.get('x-tenant-id')
  const subdomain = getSubdomainFromUrl(request.url)
  return { tenantId, subdomain }
}
