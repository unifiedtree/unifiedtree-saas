import React from 'react'
import { Clock } from 'lucide-react'

export const Payroll: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 animate-fade-in">
      <div className="max-w-md w-full bg-bg-surface border border-border-default rounded-2xl p-8 text-center space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle">
          <Clock size={28} className="text-accent-default" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-text-primary">Payroll is coming in Phase 3</h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            Full Indian-compliance payroll — PF, ESI, PT, TDS, Form 16, and direct bank disbursement —
            is planned for Phase 3. You'll be notified as soon as it's ready.
          </p>
        </div>

        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-default px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          onClick={() => alert("You'll be notified when Payroll launches.")}
        >
          Notify me
        </button>
      </div>
    </div>
  )
}
