import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { motion } from 'framer-motion'
import { resetPassword } from '@/modules/hrms/employees/api/useInvitation'

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base p-4">
        <div className="max-w-md text-center">
          <p className="text-2xl font-bold text-text-primary mb-2">Invalid link</p>
          <p className="text-text-secondary mb-4">This reset link is missing a token.</p>
          <Link to="/forgot-password" className="text-[#C16E00] font-semibold hover:underline">
            Request a new reset link →
          </Link>
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
      await resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-base p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] bg-white rounded-3xl shadow-xl border border-border-default p-10"
      >
        <div className="flex items-center gap-2.5 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF9D00]">
            <span className="text-xl font-black text-white">U</span>
          </div>
          <span className="text-xl font-black tracking-tight text-text-primary">UnifiedTree</span>
        </div>

        {done ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4">✓</div>
            <h1 className="text-xl font-bold text-text-primary mb-2">Password updated!</h1>
            <p className="text-sm text-text-secondary mb-6">You can now log in with your new password.</p>
            <Link
              to="/login"
              className="inline-block rounded-xl bg-[#FF9D00] px-6 py-3 text-sm font-bold text-white hover:bg-[#E08A00] transition-colors"
            >
              Go to login →
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-text-primary mb-1">Set new password</h1>
            <p className="text-sm text-text-secondary mb-6">Choose a new password for your account.</p>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-border-default bg-bg-base py-3 pl-10 pr-10 text-sm text-text-primary outline-none focus:border-[#FF9D00] focus:ring-4 focus:ring-[#FF9D00]/30"
                    placeholder="Minimum 8 characters"
                    required
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="w-full rounded-xl border border-border-default bg-bg-base py-3 pl-10 pr-4 text-sm text-text-primary outline-none focus:border-[#FF9D00] focus:ring-4 focus:ring-[#FF9D00]/30"
                    placeholder="Re-enter password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#FF9D00] hover:bg-[#E08A00] py-4 text-sm font-bold text-white transition-all disabled:opacity-60"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </main>
  )
}
