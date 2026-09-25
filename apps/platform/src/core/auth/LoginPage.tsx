import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Camera, Eye, EyeOff } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, AuthResponse, currentSubdomain, HttpError, WorkspaceStatus } from '@/core/api/client'
import { markWelcomeIntent } from '@/core/auth/WelcomeSplash'

/** /login's answer when the password was right but a two-factor code is needed. */
type MfaChallenge = { mfaRequired?: boolean; mfaSetupRequired?: boolean; mfaToken?: string }
type MfaSetupInfo = { secret: string; qrSvg: string; issuer: string }

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
  // Two-factor step (after a correct password): the challenge, the code typed,
  // the QR when the workspace requires set-up, and the recovery codes shown
  // once after set-up before the session starts.
  const [mfa, setMfa] = useState<{ token: string; setup: boolean; status: WorkspaceStatus } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [setupInfo, setSetupInfo] = useState<MfaSetupInfo | null>(null)
  const [recovery, setRecovery] = useState<{ codes: string[]; auth: AuthResponse; status: WorkspaceStatus } | null>(null)

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

      // mfaCapable: this page can show the two-factor step, so the server
      // answers with a challenge instead of refusing the sign-in.
      const auth = await apiJson<AuthResponse & MfaChallenge>('/v1/canonical-auth/login', {
        method: 'POST',
        body: JSON.stringify({ tenantId: status.tenantId, email, password, mfaCapable: true }),
      })
      if ((auth.mfaRequired || auth.mfaSetupRequired) && auth.mfaToken) {
        setMfaCode('')
        setSetupInfo(null)
        setMfa({ token: auth.mfaToken, setup: !!auth.mfaSetupRequired, status })
        if (auth.mfaSetupRequired) {
          setSetupInfo(await apiJson<MfaSetupInfo>('/v1/canonical-auth/login/mfa/setup', {
            method: 'POST', body: JSON.stringify({ mfaToken: auth.mfaToken }),
          }))
        }
        return
      }
      finishLogin(auth, status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  /** Start the session (shared by password-only and two-factor sign-in). */
  const finishLogin = (auth: AuthResponse, status: WorkspaceStatus) => {
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
  }

  /** The two-factor step: a code from the app, a recovery code, or the first code after set-up. */
  const handleMfaSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!mfa) return
    setLoading(true)
    setError('')
    try {
      const res = await apiJson<AuthResponse & { recoveryCodes?: string[] }>('/v1/canonical-auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ mfaToken: mfa.token, code: mfaCode.trim() }),
      })
      if (res.recoveryCodes && res.recoveryCodes.length > 0) {
        setRecovery({ codes: res.recoveryCodes, auth: res, status: mfa.status })
        return
      }
      finishLogin(res, mfa.status)
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        // The step expired (10 minutes): start again from the password.
        setMfa(null)
        setSetupInfo(null)
        setPassword('')
      }
      setError(err instanceof Error ? err.message : 'That code didn’t work')
    } finally {
      setLoading(false)
    }
  }

  const backToPassword = () => {
    setMfa(null)
    setSetupInfo(null)
    setMfaCode('')
    setError('')
  }

  const downloadCodes = (codes: string[]) => {
    const url = URL.createObjectURL(new Blob([`Recovery codes (each works once)\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'recovery-codes.txt'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const inputClass =
    'w-full rounded-[10px] border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 shadow-sm transition-all focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500'

  const labelClass = 'block text-[13.5px] font-bold text-gray-700'

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* ── Radiant emerald field ─────────────────────────────────── */}
      <div
        aria-hidden
        className="absolute inset-0 ut-ground"
      />

      {/* ── The card ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[420px] rounded-[24px] bg-white/95 px-8 pb-8 pt-10 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl"
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
        <div className="mb-8 h-px bg-gray-100" />

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

        {recovery ? (
          /* Two-factor was just set up: the recovery codes are shown once. */
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className={labelClass}>Save your recovery codes</p>
              <p className="text-[13px] leading-relaxed text-gray-600">
                If you lose your phone, each code signs you in once instead of the 6-digit code. They are shown only now; keep them somewhere safe that isn&apos;t your phone.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-[10px] border border-gray-200 bg-gray-50/50 px-4 py-3 font-mono text-sm font-semibold tracking-wide text-gray-900">
              {recovery.codes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(recovery.codes.join('\n')) }} className="h-10 flex-1 rounded-xl border border-gray-200 bg-white text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50">Copy</button>
              <button type="button" onClick={() => downloadCodes(recovery.codes)} className="h-10 flex-1 rounded-xl border border-gray-200 bg-white text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50">Download</button>
            </div>
            <button
              type="button"
              onClick={() => finishLogin(recovery.auth, recovery.status)}
              className="mt-2 flex h-[46px] w-full items-center justify-center rounded-xl bg-emerald-600 text-[15px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              I&apos;ve saved them, continue
            </button>
          </div>
        ) : mfa ? (
          /* Two-factor step: the password was right; now the code. */
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <p className={labelClass}>{mfa.setup ? 'Set up two-factor sign-in' : 'Two-factor sign-in'}</p>
              <p className="text-[13px] leading-relaxed text-gray-600">
                {mfa.setup
                  ? 'Your workspace requires a code from an authenticator app when you sign in. Scan this with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code it shows.'
                  : 'Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes instead.'}
              </p>
            </div>
            {mfa.setup && (setupInfo ? (
              <div className="flex flex-col items-center gap-2">
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setupInfo.qrSvg)}`} alt="QR code to scan with your authenticator app" width={168} height={168} className="rounded-[10px] border border-gray-200 bg-white p-1" />
                <p className="text-center text-[12.5px] text-gray-500">Can&apos;t scan? Enter this setup key:</p>
                <p className="break-all text-center font-mono text-[13px] font-bold tracking-wider text-gray-900">{setupInfo.secret.match(/.{1,4}/g)?.join(' ')}</p>
              </div>
            ) : (
              <p className="text-center text-[13px] text-gray-500">Preparing your QR code…</p>
            ))}
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="mfa-code">{mfa.setup ? '6-digit code' : 'Code'}</label>
              <input
                id="mfa-code"
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className={`${inputClass} font-mono tracking-widest`}
                placeholder="123456"
                inputMode={mfa.setup ? 'numeric' : 'text'}
                autoComplete="one-time-code"
                maxLength={mfa.setup ? 7 : 11}
                autoFocus
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !mfaCode.trim() || (mfa.setup && !setupInfo)}
              className="mt-6 flex h-[46px] w-full items-center justify-center rounded-xl bg-emerald-600 text-[15px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-70"
            >
              {loading ? 'Checking…' : mfa.setup ? 'Turn on and sign in' : 'Verify'}
            </button>
            <p className="pt-1 text-center">
              <button type="button" onClick={backToPassword} className="text-[13.5px] font-medium text-[var(--text-link)] hover:underline">
                Back to sign in
              </button>
            </p>
          </form>
        ) : needsWorkspace ? (
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
              className="mt-6 flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[15px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-70"
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
              className="mt-6 flex h-[46px] w-full items-center justify-center rounded-xl bg-emerald-600 text-[15px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-70"
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

        <div className="mt-8 h-px bg-gray-100" />
        <p className="pt-5 text-center text-[13px] font-medium text-gray-500">
          Powered by{' '}
          <a href="https://unifiedtree.com" className="font-bold text-emerald-600 hover:underline">
            UnifiedTree
          </a>
        </p>

        {/* Which workspace this sign-in belongs to — small, under the card frame */}
        {!needsWorkspace && (
          <p className="pt-2 text-center text-[12px] font-medium text-gray-400">{workspaceLabel}</p>
        )}
      </motion.div>
    </main>
  )
}
