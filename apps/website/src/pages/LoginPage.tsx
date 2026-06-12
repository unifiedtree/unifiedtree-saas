import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Loader2, Check, Mail, Lock, ArrowLeft } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuthStore } from '../store/authStore'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  remember: z.boolean().optional(),
})

type FormData = z.infer<typeof schema>

const trustPoints = [
  'Offline-first — works without internet',
  'GST-compliant invoicing & payroll',
  'Bank-grade encryption (AES-256)',
]

function SmallTree() {
  return (
    <svg width="100" height="120" viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-90 filter drop-shadow-[0_4px_12px_rgba(29,185,133,0.35)]">
      <path d="M60 155 L60 90" stroke="url(#stemGrad)" strokeWidth="6" strokeLinecap="round"/>
      <path d="M60 90 L30 55" stroke="url(#branchGrad)" strokeWidth="4" strokeLinecap="round"/>
      <path d="M60 90 L90 55" stroke="url(#branchGrad)" strokeWidth="4" strokeLinecap="round"/>
      <path d="M60 75 L38 40" stroke="url(#branchGrad)" strokeWidth="3" strokeLinecap="round"/>
      <path d="M60 75 L82 40" stroke="url(#branchGrad)" strokeWidth="3" strokeLinecap="round"/>
      <path d="M60 60 L60 20" stroke="url(#branchGrad)" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="60" cy="18" r="8" fill="#1DB985"/>
      <circle cx="30" cy="53" r="6" fill="#1DB985" opacity="0.9"/>
      <circle cx="90" cy="53" r="6" fill="#1DB985" opacity="0.9"/>
      <circle cx="38" cy="38" r="5" fill="#E8F5F0" opacity="0.8"/>
      <circle cx="82" cy="38" r="5" fill="#E8F5F0" opacity="0.8"/>
      <defs>
        <linearGradient id="stemGrad" x1="60" y1="155" x2="60" y2="90" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8F5F0" />
          <stop offset="1" stopColor="#1DB985" />
        </linearGradient>
        <linearGradient id="branchGrad" x1="60" y1="90" x2="60" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1DB985" />
          <stop offset="1" stopColor="#E8F5F0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const initialEmail = searchParams.get('email') ?? ''
  const createdWorkspace = searchParams.get('created') === '1'
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  // Forgot-password modal state. Backend POST /v1/auth/forgot-password
  // resolves the workspace from the email and queues a reset email; it
  // always returns 200 (no email-existence leak).
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')

  const openForgot = (prefill?: string) => {
    setForgotEmail(prefill ?? initialEmail ?? '')
    setForgotError('')
    setForgotSent(false)
    setForgotOpen(true)
  }
  const closeForgot = () => {
    if (forgotSending) return
    setForgotOpen(false)
  }
  const submitForgot = async () => {
    const email = forgotEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotError('Enter a valid email address.')
      return
    }
    setForgotSending(true)
    setForgotError('')
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // 200 even when email doesn't exist (intentional no-leak). Treat any
      // non-network response as success from the user's perspective.
      if (!res.ok && res.status >= 500) {
        throw new Error(`Server error (${res.status})`)
      }
      setForgotSent(true)
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Could not send the reset email. Please try again.')
    } finally {
      setForgotSending(false)
    }
  }

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: initialEmail,
      remember: false,
    },
  })

  const setAccountAuth = useAuthStore(s => s.setAccountAuth);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const response = await api.post('/v1/accounts/auth/login', {
        email: data.email,
        password: data.password
      })
      setAccountAuth(response.accessToken, response.account, response.workspaces)
      setSuccess(true)
      await new Promise((r) => setTimeout(r, 500))
      navigate('/workspaces')
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg select-none">
      <Navbar />
      
      <main className="flex-1 flex flex-col items-center justify-center pt-32 pb-20 hero-gradient relative overflow-hidden">
        {/* Glow orbs & pattern */}
        <div className="absolute top-10 -left-20 w-96 h-96 bg-accent rounded-full blur-[130px] opacity-20 pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-10 -right-20 w-96 h-96 bg-primary-light rounded-full blur-[130px] opacity-15 pointer-events-none animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute inset-0 opacity-10 pattern-dots" />

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10 px-4"
        >
          {/* Back Button */}
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors font-body font-medium text-sm group">
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Back to Home
            </Link>
          </div>

          {/* Form premium-card */}
          <div className="bg-surface rounded-2xl border border-border shadow-xl hover:shadow-2xl hover:border-primary/20 transition-all duration-300 p-8 sm:p-10 relative">
            {/* Corner highlight line */}
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-accent rounded-t-2xl" />

            <h2 className="font-heading font-bold text-text-primary text-3xl mb-1.5 tracking-tight">Welcome back</h2>
            <p className="text-text-secondary font-body text-sm mb-8">Sign in to your UnifiedTree workspace</p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {createdWorkspace && (
                <div className="bg-primary/5 text-primary-dark text-sm font-medium p-3 rounded-lg border border-primary/15 flex items-center gap-2">
                  <Check size={16} className="text-primary" />
                  Workspace created. Sign in to open your workspace switcher.
                </div>
              )}
              {errorMessage && (
                <div className="bg-red-50 text-red-600 text-sm font-medium p-3 rounded-lg border border-red-100 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                  {errorMessage}
                </div>
              )}
              {/* Email */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">
                  Work Email
                </label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Mail size={18} />
                  </div>
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="you@company.com"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.email ? 'border-danger' : 'border-border'
                    }`}
                  />
                </div>
                {errors.email && (
                  <p className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">
                  Password
                </label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Lock size={18} />
                  </div>
                  <input
                    {...register('password')}
                    type={showPass ? 'text' : 'password'}
                    placeholder="Min. 8 characters"
                    className={`w-full pl-11 pr-12 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.password ? 'border-danger' : 'border-border'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary transition-colors p-1 rounded-md hover:bg-bg"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Remember + forgot */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    {...register('remember')}
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 focus:ring-offset-0 focus:ring-2 accent-primary transition-all cursor-pointer"
                  />
                  <span className="text-sm text-text-secondary font-body group-hover:text-text-primary transition-colors">Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={() => openForgot()}
                  className="text-sm text-primary hover:text-primary-dark hover:underline font-body font-semibold transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || success}
                className="w-full py-3.5 rounded-xl bg-primary text-white font-body font-semibold text-sm hover:bg-primary-dark transition-all disabled:opacity-70 flex items-center justify-center gap-2 btn-shimmer shadow-teal hover:shadow-teal-lg active:scale-[0.99] transform"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {success && <Check size={16} />}
                {loading ? 'Signing in...' : success ? 'Success!' : 'Sign In'}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-secondary font-body font-medium uppercase tracking-wider">or continue with</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Google SSO */}
            <button className="w-full py-3 rounded-xl border border-border bg-surface hover:bg-surface-2 hover:border-primary/20 hover:shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-3 text-sm font-body font-semibold text-text-primary group">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="group-hover:scale-105 transition-transform">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <p className="text-center text-sm text-text-secondary font-body mt-6">
              Don't have an account?{' '}
              <Link to="/pricing" className="text-primary font-semibold hover:text-primary-dark hover:underline transition-colors">
                Create free workspace
              </Link>
            </p>
          </div>
        </motion.div>
      </main>

      {/* Forgot-password modal */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm"
          onClick={closeForgot}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-title"
        >
          <div
            className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-border p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {forgotSent ? (
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-success/10 mx-auto mb-4">
                  <Check size={22} className="text-success" />
                </div>
                <h2 id="forgot-title" className="text-xl font-heading font-bold text-text-primary text-center mb-2">
                  Check your email
                </h2>
                <p className="text-sm text-text-secondary text-center mb-6">
                  If <span className="font-semibold text-text-primary">{forgotEmail}</span> matches an account, we&rsquo;ve sent a password-reset link. It expires in 1 hour.
                </p>
                <button
                  type="button"
                  onClick={closeForgot}
                  className="w-full py-3 rounded-xl bg-primary text-white font-body font-semibold text-sm hover:bg-primary-dark transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
                  <Mail size={22} className="text-primary" />
                </div>
                <h2 id="forgot-title" className="text-xl font-heading font-bold text-text-primary text-center mb-2">
                  Reset your password
                </h2>
                <p className="text-sm text-text-secondary text-center mb-5">
                  Enter your work email and we&rsquo;ll send you a link to set a new password.
                </p>
                <label className="block text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                  Work Email
                </label>
                <div className="relative mb-4">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="email"
                    autoFocus
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); if (forgotError) setForgotError('') }}
                    placeholder="you@company.com"
                    disabled={forgotSending}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitForgot() }}
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-surface text-text-primary placeholder:text-text-tertiary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                {forgotError && (
                  <p className="text-danger text-xs mb-3 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger" />
                    {forgotError}
                  </p>
                )}
                <div className="flex gap-3 mt-2">
                  <button
                    type="button"
                    onClick={closeForgot}
                    disabled={forgotSending}
                    className="flex-1 py-3 rounded-xl border border-border text-text-secondary font-body font-semibold text-sm hover:bg-surface-2 transition-colors disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitForgot}
                    disabled={forgotSending || !forgotEmail.trim()}
                    className="flex-1 py-3 rounded-xl bg-primary text-white font-body font-semibold text-sm hover:bg-primary-dark transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                  >
                    {forgotSending && <Loader2 size={14} className="animate-spin" />}
                    {forgotSending ? 'Sending…' : 'Send reset link'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
