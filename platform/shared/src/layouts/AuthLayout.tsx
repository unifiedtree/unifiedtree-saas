import React from 'react'

interface AuthLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  showBrand?: boolean
}

export function AuthLayout({
  children,
  title,
  subtitle,
  showBrand = true,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-[#070B14] flex">
      {/* Brand panel */}
      {showBrand && (
        <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between p-12 bg-gradient-to-br from-indigo-950 via-[#0D1117] to-[#070B14] border-r border-white/5 relative overflow-hidden">
          {/* Decorative orbs */}
          <div className="absolute top-20 left-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />

          {/* Logo */}
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
                <span className="text-white font-bold text-lg">N</span>
              </div>
              <span className="text-white font-semibold text-xl tracking-tight">UnifiedTree</span>
            </div>
          </div>

          {/* Tagline */}
          <div className="relative z-10">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
              Run your entire
              <br />
              <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                business in one place
              </span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed mb-12">
              Unified ERP platform for HR, CRM, Finance, and Operations — built for modern teams.
            </p>

            {/* Testimonial */}
            <div className="bg-white/5 backdrop-blur rounded-2xl p-6 border border-white/10">
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                "UnifiedTree transformed how we manage our 500-person team. Everything from payroll to pipeline,
                all in one beautiful interface."
              </p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-sm font-semibold">
                  S
                </div>
                <div>
                  <div className="text-white text-sm font-medium">Sarah Chen</div>
                  <div className="text-slate-500 text-xs">COO, Meridian Technologies</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content slot */}
      <div
        className={`flex-1 flex flex-col items-center justify-center p-8 ${
          !showBrand ? 'w-full' : ''
        }`}
      >
        <div className="w-full max-w-md">
          {(title || subtitle) && (
            <div className="mb-8">
              {title && (
                <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
              )}
              {subtitle && (
                <p className="text-slate-400">{subtitle}</p>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
