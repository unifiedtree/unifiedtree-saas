import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail, Users } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { apiJson, AuthResponse, currentSubdomain, WorkspaceStatus } from '@/core/api/client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const loginWithCredentials = useSdkStore((state) => state.loginWithCredentials)

  const [email,       setEmail]       = useState(searchParams.get('email') || 'admin@unifiedtree.demo')
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

  return (
    <main className="flex min-h-screen bg-[#F8FAFC] font-body relative overflow-hidden items-center justify-center p-4">
      {/* Soft background elements */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#E6F4F1] to-transparent pointer-events-none" />
      <div className="absolute -top-48 -right-48 w-96 h-96 bg-[#14B8A6]/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 -left-48 w-96 h-96 bg-[#0F6E56]/10 rounded-full blur-[100px] pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[440px] bg-white rounded-3xl shadow-xl shadow-[#0F6E56]/5 border border-slate-100 p-8 sm:p-12 relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center justify-center gap-4 mb-8">
          <img src="/UnifiedTreeLogo.png" alt="UnifiedTree Logo" className="h-12 w-auto object-contain" />
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight mb-1">
              Welcome back
            </h2>
            <p className="text-sm text-slate-500">
              Sign in to your workspace <span className="font-semibold text-slate-700">{workspaceLabel}</span>
            </p>
          </div>
        </div>

        {workspaceStatus && workspaceStatus.status !== 'ACTIVE' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 flex items-center gap-3 rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3.5 text-sm font-medium text-warning"
          >
            <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            This workspace is pending approval.
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3.5 text-sm font-medium text-danger text-center"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {needsWorkspace && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Workspace Domain
              </label>
              <input
                type="text"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#0F6E56] focus:bg-white focus:ring-4 focus:ring-[#0F6E56]/10"
                placeholder="yourcompany"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Email Address
            </label>
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#0F6E56] focus:bg-white focus:ring-4 focus:ring-[#0F6E56]/10"
                placeholder="you@company.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <Link to="/forgot-password" className="text-xs font-semibold text-[#0F6E56] hover:underline">Forgot password?</Link>
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-11 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#0F6E56] focus:bg-white focus:ring-4 focus:ring-[#0F6E56]/10"
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 transition-colors hover:text-slate-700 rounded-lg"
              >
                {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F6E56] hover:bg-[#0A5240] px-4 py-4 text-sm font-bold text-white shadow-lg shadow-[#0F6E56]/20 transition-all disabled:opacity-70 active:scale-[0.98]"
          >
            {loading ? 'Signing in...' : 'Sign in'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>
        
        <p className="mt-8 text-center text-sm text-slate-500">
          Powered by{' '}
          <a href="https://unifiedtree.com" className="font-semibold text-[#0F6E56] hover:underline">UnifiedTree</a>
        </p>
      </motion.div>
    </main>
  )
}
