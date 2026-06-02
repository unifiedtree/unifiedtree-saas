import React, { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { acceptInvite } from '@/modules/hrms/employees/api/useInvitation'

function strengthLabel(pw: string): { label: string; color: string; width: string } {
  if (pw.length === 0) return { label: '', color: 'bg-slate-200', width: 'w-0' }
  const score = [pw.length >= 8, /[A-Z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length
  if (score <= 1) return { label: 'Weak', color: 'bg-red-500', width: 'w-1/4' }
  if (score === 2) return { label: 'Fair', color: 'bg-amber-500', width: 'w-2/4' }
  if (score === 3) return { label: 'Good', color: 'bg-blue-500', width: 'w-3/4' }
  return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full' }
}

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const loginWithCredentials = useSdkStore(s => s.loginWithCredentials)
  const token = searchParams.get('token') ?? ''

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)

  const strength = strengthLabel(password)

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
        <div className="max-w-md text-center">
          <p className="text-2xl font-bold text-slate-900 mb-2">Invalid link</p>
          <p className="text-slate-500">This invitation link is missing a token. Check the email you received.</p>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')
    try {
      const res = await acceptInvite(token, password)
      loginWithCredentials({
        token:         res.accessToken,
        userId:        res.userId,
        email:         res.email,
        roles:         res.roles,
        permissions:   res.permissions,
        tenantId:      res.tenantId,
        tenantSlug:    res.tenantSlug,
        tenantName:    res.tenantName,
        activeModules: res.activeModules,
      })
      setDone(true)
      setTimeout(() => navigate('/me', { replace: true }), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
      <div className="absolute -top-48 -right-48 w-96 h-96 bg-[#14B8A6]/15 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] bg-white rounded-3xl shadow-xl border border-slate-100 p-10 relative z-10"
      >
        <div className="flex items-center gap-2.5 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F6E56]">
            <span className="text-xl font-black text-white">U</span>
          </div>
          <span className="text-xl font-black tracking-tight text-slate-900">UnifiedTree</span>
        </div>

        {done ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">✓</div>
            <p className="text-lg font-semibold text-slate-900">Account activated!</p>
            <p className="text-sm text-slate-500 mt-1">Logging you in…</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Set your password</h1>
            <p className="text-sm text-slate-500 mb-6">Create a password to activate your account and log in.</p>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-sm text-slate-900 outline-none focus:border-[#0F6E56] focus:ring-4 focus:ring-[#0F6E56]/10"
                    placeholder="Minimum 8 characters"
                    required
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${strength.color} ${strength.width}`} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{strength.label}</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0F6E56] focus:ring-4 focus:ring-[#0F6E56]/10"
                    placeholder="Re-enter password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl bg-[#0F6E56] hover:bg-[#0A5240] py-4 text-sm font-bold text-white transition-all disabled:opacity-60"
              >
                {loading ? 'Activating account…' : 'Activate account'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </main>
  )
}
