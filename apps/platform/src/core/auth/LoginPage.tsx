import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Eye, EyeOff, Lock, Mail, Check,
  ShieldCheck, Clock3, BarChart3,
} from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, AuthResponse, currentSubdomain, WorkspaceStatus } from '@/core/api/client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HIGHLIGHTS = [
  { icon: Clock3,     title: 'Attendance & leave', desc: 'Geofenced check-ins, shifts and approvals in one place.' },
  { icon: BarChart3,  title: 'Payroll that runs itself', desc: 'Salary structures, PLI and payslips, automated.' },
  { icon: ShieldCheck, title: 'Compliance built-in', desc: 'Statutory registers, muster rolls and audit trails.' },
]

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const loginWithCredentials = useSdkStore((state) => state.loginWithCredentials)

  const [email,       setEmail]       = useState(searchParams.get('email') || '')
  const [password,    setPassword]    = useState('')
  const [workspace,   setWorkspace]   = useState(searchParams.get('tid') || searchParams.get('workspace') || 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
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

  const resolveWorkspaceStatus = async (): Promise<WorkspaceStatus> => {
    if (workspaceStatus) return workspaceStatus

    const ws = workspace.trim()
    if (UUID_RE.test(ws)) {
      return {
        tenantId:         ws,
        tenantName:       'Workspace',
        subdomain:        '',
        status:           'ACTIVE',
        activeModules:    ['hrms'],
        requestedModules: [],
      }
    }

    return apiJson<WorkspaceStatus>('/v1/public/workspace-status', {
      headers: { 'X-Tenant-Subdomain': ws },
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (needsWorkspace && !workspace.trim()) {
      setError('Enter your workspace domain or tenant ID')
      return
    }
    setLoading(true)
    setError('')
    try {
      const status = await resolveWorkspaceStatus()
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
        roles:         auth.roles,
        permissions:   auth.permissions ?? [],
        tenantId:      status.tenantId,
        tenantSlug:    status.subdomain,
        tenantName:    status.tenantName,
        activeModules: status.activeModules,
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] shadow-xs outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--border-focus)] focus:ring-4 focus:ring-[var(--accent-solid)]/12'

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      {/* ── Brand panel ─────────────────────────────────────────── */}
      <div className="relative hidden overflow-hidden bg-[#053B2E] lg:flex lg:flex-col">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(150deg, #064E3B 0%, #047857 42%, #059669 100%)' }}
        />
        {/* decorative glow */}
        <div className="orb -left-32 -top-24 h-96 w-96" style={{ background: 'rgba(52,211,153,0.35)' }} />
        <div className="orb -bottom-40 -right-24 h-[28rem] w-[28rem]" style={{ background: 'rgba(6,78,59,0.6)' }} />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.35) 1px, transparent 0)', backgroundSize: '28px 28px' }}
        />

        <div className="relative z-10 flex h-full flex-col p-12 xl:p-16">
          {/* wordmark */}
          <div className="flex items-center gap-3">
            <img src="/UnifiedTreeLogoWhite.png" alt="Unified Tree" className="h-9 w-auto" />
          </div>

          {/* headline */}
          <div className="mt-auto">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-md text-4xl font-semibold leading-[1.15] tracking-tight text-white"
            >
              The operating system for your people.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="mt-4 max-w-md text-[15px] leading-relaxed text-emerald-50/80"
            >
              HR, attendance, payroll and every connected module — unified into one calm, powerful workspace.
            </motion.p>

            <div className="mt-10 space-y-4">
              {HIGHLIGHTS.map((h, i) => (
                <motion.div
                  key={h.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.16 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-start gap-3.5"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/12 text-emerald-100 ring-1 ring-white/15">
                    <h.icon size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{h.title}</p>
                    <p className="text-[13px] text-emerald-50/70">{h.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-2 pt-12 text-[13px] text-emerald-50/60">
            <Check size={14} className="text-emerald-200" />
            Trusted by modern teams to run their entire workforce.
          </div>
        </div>
      </div>

      {/* ── Form panel ──────────────────────────────────────────── */}
      <div className="relative flex items-center justify-center bg-[var(--bg-surface)] px-6 py-12 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[400px]"
        >
          {/* Mobile brand mark */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/UnifiedTreeLogo.png" alt="Unified Tree" className="h-7 w-auto" />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Welcome back</h2>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              Sign in to <span className="font-medium text-[var(--text-primary)]">{workspaceLabel}</span>
            </p>
          </div>

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

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsWorkspace && (
              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-[var(--text-secondary)]">Workspace domain</label>
                <input
                  type="text"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  className={`${inputClass} px-3.5`}
                  placeholder="yourcompany"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-[var(--text-secondary)]">Email address</label>
              <div className="relative">
                <Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${inputClass} pl-10 pr-3.5`}
                  placeholder="you@company.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[13px] font-medium text-[var(--text-secondary)]">Password</label>
                <Link to="/forgot-password" className="text-[13px] font-medium text-[var(--text-link)] hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pl-10 pr-11`}
                  placeholder="Enter your password"
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
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--interactive-primary)] text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[var(--interactive-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-70"
            >
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="mt-8 text-center text-[13px] text-[var(--text-tertiary)]">
            Powered by{' '}
            <a href="https://unifiedtree.com" className="font-medium text-[var(--text-link)] hover:underline">UnifiedTree</a>
          </p>
        </motion.div>
      </div>
    </main>
  )
}
