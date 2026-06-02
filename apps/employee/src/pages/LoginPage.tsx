import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Users } from 'lucide-react'
import { setEmployeeSession, type EmployeeSession } from '../auth'

type AuthResponse = {
  accessToken: string
  refreshToken?: string
  userId?: string
  employeeId?: string
  tenantId: string
  email: string
  roles?: string[]
  permissions?: string[]
}

const DEMO_TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState(DEMO_TENANT_ID)
  const [email, setEmail] = useState('reader@unifiedtree.demo')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/v1/canonical-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: workspace.trim(),
          email: email.trim(),
          password,
        }),
      })

      const data = (await response.json()) as AuthResponse & { message?: string; error?: string }

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Invalid email or password')
      }

      const session: EmployeeSession = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        userId: data.userId || data.employeeId || '',
        employeeId: data.employeeId,
        tenantId: data.tenantId,
        email: data.email,
        roles: data.roles ?? [],
        permissions: data.permissions ?? [],
      }

      setEmployeeSession(session)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0A0F1E] text-slate-100">
      <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden border-r border-slate-800/70 bg-[#0D1421] px-12 py-10 lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
              <Users size={22} />
            </div>
            <div>
              <p className="text-lg font-bold text-white">UnifiedTree</p>
              <p className="text-xs text-slate-500">Employee Portal</p>
            </div>
          </div>

          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">Secure access</p>
            <h1 className="mt-4 text-5xl font-bold leading-tight tracking-normal text-white">
              Sign in before opening employee tools.
            </h1>
            <p className="mt-5 text-sm leading-6 text-slate-400">
              Attendance, leave, payslips, profile details, and support requests stay behind your workspace login.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
              <ShieldCheck size={18} className="text-emerald-300" />
              <p className="mt-3 text-sm font-semibold text-white">Session based</p>
              <p className="mt-1 text-xs text-slate-500">Clears when the browser session ends.</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
              <Lock size={18} className="text-indigo-300" />
              <p className="mt-3 text-sm font-semibold text-white">Backend verified</p>
              <p className="mt-1 text-xs text-slate-500">Uses the canonical HRMS login API.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-lg border border-slate-800 bg-[#111827] p-8 shadow-2xl shadow-black/30"
          >
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-white">
                <Users size={20} />
              </div>
              <div>
                <p className="font-bold text-white">UnifiedTree</p>
                <p className="text-xs text-slate-500">Employee Portal</p>
              </div>
            </div>

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Employee login</p>
            <h2 className="mt-3 text-3xl font-bold tracking-normal text-white">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-400">Use your workspace credentials to continue.</p>

            {error && (
              <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
                {error}
              </div>
            )}

            <label className="mt-7 block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Workspace / tenant ID</span>
              <input
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                placeholder="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
                required
              />
            </label>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Email</span>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-3 pl-11 pr-4 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="reader@unifiedtree.demo"
                  required
                />
              </div>
            </label>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Password</span>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-3 pl-11 pr-11 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Enter password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign in'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
