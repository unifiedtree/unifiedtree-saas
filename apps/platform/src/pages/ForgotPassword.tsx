import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { motion } from 'framer-motion'
import { forgotPassword } from '@/modules/hrms/employees/api/useInvitation'
import { currentSubdomain } from '@/core/api/client'

export const ForgotPassword: React.FC = () => {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const subdomain = currentSubdomain()
      await forgotPassword(email, subdomain || undefined)
      setSent(true)
    } catch {
      // Still show success — don't leak email existence
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-base p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] bg-white rounded-3xl shadow-xl border border-slate-100 p-10"
      >
        <div className="flex items-center gap-2.5 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF9D00]">
            <span className="text-xl font-black text-white">U</span>
          </div>
          <span className="text-xl font-black tracking-tight text-slate-900">UnifiedTree</span>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mx-auto mb-4">
              <Mail size={24} className="text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Check your inbox</h1>
            <p className="text-sm text-slate-500 mb-6">
              If an account exists for <strong>{email}</strong>, a password reset link has been sent.
              Check your spam folder if you don't see it.
            </p>
            <Link to="/login" className="text-sm font-semibold text-[#C16E00] hover:underline">
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Forgot password?</h1>
            <p className="text-sm text-slate-500 mb-6">
              Enter your email and we'll send a reset link.
            </p>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#FF9D00] focus:ring-4 focus:ring-[#FF9D00]/30"
                    placeholder="you@company.com"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#FF9D00] hover:bg-[#E08A00] py-4 text-sm font-bold text-white transition-all disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <Link to="/login" className="block text-center text-sm text-slate-500 hover:text-slate-700 transition-colors">
                Back to login
              </Link>
            </form>
          </>
        )}
      </motion.div>
    </main>
  )
}
