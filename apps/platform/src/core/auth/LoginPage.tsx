import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Camera, Eye, EyeOff } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, AuthResponse, currentSubdomain, WorkspaceStatus } from '@/core/api/client'
import { markWelcomeIntent } from '@/core/auth/WelcomeSplash'

/** Workspace slugs are lowercase alphanumeric + hyphens, like a DNS label. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

/**
 * Build the branded login URL for a workspace on whatever host we're on, so
 * this works identically on ionora.localhost:3001 and ionora.unifiedtree.com.
 */
function workspaceLoginUrl(slug: string): string {
  const { protocol, hostname, port } = window.location
  const base = hostname.toLowerCase().endsWith('.localhost') || hostname.toLowerCase() === 'localhost'
    ? 'localhost'
    : hostname.toLowerCase().split('.').slice(-2).join('.')
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ''}/login`
}

/**
 * Login — a single centred card on a radiant emerald field.
 *
 * The card leads with the WORKSPACE's own logo (Settings → Branding), falling
 * back to a "Your logo" placeholder, so every tenant's sign-in feels like
 * theirs — UnifiedTree keeps its "Powered by" footer credit. All auth
 * logic (workspace-status resolution, canonical login, the no-subdomain
 * workspace-picker step) is unchanged from the previous layout.
 */
export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const loginWithCredentials = useSdkStore((state) => state.loginWithCredentials)

  const [email,       setEmail]       = useState(searchParams.get('email') || '')
  const [password,    setPassword]    = useState('')
  const [workspace,   setWorkspace]   = useState(searchParams.get('workspace') || '')
  const [showPwd,     setShowPwd]     = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null)

  const subdomain = useMemo(() => currentSubdomain(), [])
  const needsWorkspace = !subdomain
  const workspaceLabel = useMemo(() => {
    if (!subdomain) return 'Workspace login'
    const host = window.location.hostname.toLowerCase()
    if (host.endsWith('.localhost')) return `${subdomain}.localhost`
    return `${subdomain}.unifiedtree.com`
  }, [subdomain])

  useEffect(() => {
    if (subdomain) {
      apiJson<WorkspaceStatus>('/v1/public/workspace-status')
        .then(setWorkspaceStatus)
        .catch(() => undefined)
    }
  }, [subdomain])

  /**
   * No subdomain means we cannot know whose workspace this is — and every
   * workspace has its own branding. Rather than asking for a tenant ID here,
   * we look the slug up, then hand the visitor to their OWN branded login at
   * <slug>.<host>/login. One canonical login surface, always branded.
   */
  const handleWorkspaceContinue = async (event: React.FormEvent) => {
    event.preventDefault()
    const slug = workspace.trim().toLowerCase()
    if (!slug) {
      setError('Enter your workspace name')
      return
    }
    if (!SLUG_RE.test(slug)) {
      setError('Use just the workspace name, e.g. "ionora"')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Verify it exists before redirecting, so a typo fails here with a clear
      // message instead of dumping the user on a dead subdomain.
      await apiJson<WorkspaceStatus>('/v1/public/workspace-status', {
        headers: { 'X-Tenant-Subdomain': slug },
      })
      window.location.href = workspaceLoginUrl(slug)
    } catch {
      setError(`No workspace called "${slug}". Check the name and try again.`)
      setLoading(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const status = workspaceStatus ?? (await apiJson<WorkspaceStatus>('/v1/public/workspace-status'))
      if (status.status !== 'ACTIVE') {
        setWorkspaceStatus(status)
        navigate('/pending-approval')
        return
      }

      const auth = await apiJson<AuthResponse>('/v1/canonical-auth/login', {
        method: 'POST',
        body: JSON.stringify({ tenantId: status.tenantId, email, password }),
      })

      loginWithCredentials({
        token:         auth.accessToken,
        userId:        auth.userId || auth.employeeId || '',
        email:         auth.email,
        // The backend resolves these from hrms.employees. Omitting them made
        // the SDK fall back to the email local-part, so a workspace created by
        // "Chakri Chikkala" greeted them as "Shurya.kumar063".
        firstName:     auth.firstName,
        lastName:      auth.lastName,
        roles:         auth.roles,
        permissions:   auth.permissions ?? [],
        tenantId:      status.tenantId,
        tenantSlug:    status.subdomain,
        tenantName:    status.tenantName,
        activeModules: status.activeModules,
      })
      // Signing in is an arrival, and the only thing that earns the welcome
      // animation. AuthProvider consumes this flag exactly once, so reloads
      // afterwards stay silent.
      markWelcomeIntent()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] shadow-xs outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--border-focus)] focus:ring-4 focus:ring-[var(--accent-solid)]/12'

  const labelClass = 'block text-[13.5px] font-semibold text-[var(--text-primary)]'

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* ── Radiant emerald field ─────────────────────────────────── */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: '#EDF9F3',
          backgroundImage: [
            // radiant glow rising from the lower-left, like low sun through leaves
            'radial-gradient(60% 55% at 12% 92%, rgba(5, 150, 105, 0.22), transparent 68%)',
            'radial-gradient(55% 50% at 90% 6%, rgba(16, 185, 129, 0.18), transparent 70%)',
            'radial-gradient(70% 60% at 50% 50%, rgba(167, 243, 208, 0.28), transparent 75%)',
            // the diagonal sheen Odoo's field has, redone in emerald
            'linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.55) 38%, transparent 52%, rgba(255,255,255,0.35) 74%, transparent 88%)',
            'linear-gradient(160deg, #E3F5EC 0%, #EDF9F3 45%, #DFF3E9 100%)',
          ].join(', '),
        }}
      />

      {/* ── The card ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        /* Same .ut-card surface as every card inside the product, at the
           large radius — the login box is the first card a user ever sees, so
           it should be made of the same material as the rest. */
        className="ut-card ut-card-lg relative w-full max-w-[400px] px-8 pb-7 pt-8"
      >
        {/* Workspace logo — theirs when uploaded; otherwise an Odoo-style
            "Your logo" placeholder (the striped texture is a small inside-the-
            placeholder cue, kept at a whisper of emerald). */}
        <div className="flex items-center justify-center pb-6">
          {workspaceStatus?.logoUrl ? (
            <img
              src={workspaceStatus.logoUrl}
              alt={workspaceStatus.tenantName || 'Unified Tree'}
              className="max-h-12 w-auto max-w-[220px] object-contain"
            />
          ) : (
            <div
              className="flex h-12 w-full max-w-[220px] items-center justify-center gap-2 rounded-lg"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(5,150,105,0.10) 0px, rgba(5,150,105,0.10) 7px, rgba(5,150,105,0.04) 7px, rgba(5,150,105,0.04) 14px)',
              }}
            >
              <Camera size={18} strokeWidth={2} className="text-[#047857]/55" aria-hidden />
              <span className="select-none text-sm font-semibold text-[#047857]/55">Your logo</span>
            </div>
          )}
        </div>
        <div className="mb-6 h-px bg-[var(--border-default)]" />

        {workspaceStatus && workspaceStatus.status !== 'ACTIVE' && (
          <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3.5 py-3 text-sm font-medium text-[var(--status-warning-fg)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-warning-solid)]" />
            This workspace is pending approval.
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-3.5 py-3 text-sm font-medium text-[var(--status-error-fg)]"
          >
            {error}
          </motion.div>
        )}

        {needsWorkspace ? (
          /* No subdomain: ask only which workspace, then hand off to its own
             branded login. No credentials are collected on this screen. */
          <form onSubmit={handleWorkspaceContinue} className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Workspace</label>
              <div className="flex items-stretch rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--border-focus)] focus-within:ring-4 focus-within:ring-[var(--accent-solid)]/12">
                <input
                  type="text"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  className="w-full rounded-l-lg bg-transparent px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
                  placeholder="yourcompany"
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                />
                <span className="flex select-none items-center rounded-r-lg border-l border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 text-[13px] text-[var(--text-tertiary)]">
                  .unifiedtree.com
                </span>
              </div>
              <p className="text-[12.5px] text-[var(--text-tertiary)]">
                We&apos;ll take you to your workspace&apos;s sign-in page.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--interactive-primary)] text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[var(--interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-70"
            >
              {loading ? 'Finding workspace…' : 'Continue'}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className={labelClass}>Password</label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-medium text-[var(--text-link)] hover:underline"
                >
                  Reset Password
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-11`}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-secondary)]"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-11 w-full items-center justify-center rounded-lg bg-[var(--interactive-primary)] text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[var(--interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-70"
            >
              {loading ? 'Logging in…' : 'Log in'}
            </button>

            <p className="pt-1 text-center">
              <a
                href="https://unifiedtree.com/signup"
                className="text-[13.5px] font-medium text-[var(--text-link)] hover:underline"
              >
                Don&apos;t have an account?
              </a>
            </p>
          </form>
        )}

        <div className="mt-6 h-px bg-[var(--border-default)]" />
        <p className="pt-4 text-center text-[13px] text-[var(--text-tertiary)]">
          Powered by{' '}
          <a href="https://unifiedtree.com" className="font-semibold text-[var(--text-link)] hover:underline">
            UnifiedTree
          </a>
        </p>

        {/* Which workspace this sign-in belongs to — small, under the card frame */}
        {!needsWorkspace && (
          <p className="pt-1.5 text-center text-[11.5px] text-[var(--text-tertiary)]">{workspaceLabel}</p>
        )}
      </motion.div>
    </main>
  )
}
