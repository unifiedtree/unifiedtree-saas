import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, RefreshCcw } from 'lucide-react'
import { apiJson, WorkspaceStatus } from '@/core/api/client'

export const PendingApproval: React.FC = () => {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setStatus(await apiJson<WorkspaceStatus>('/v1/public/workspace-status'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <main className="min-h-screen bg-[#ECFDF5] px-4 py-16">
      <section className="ut-card ut-card-lg mx-auto max-w-3xl p-8">
        <div className="mb-10 inline-flex items-center gap-3">
          <img
            src="/assets/unifiedtree-logo.png"
            alt=""
            aria-hidden="true"
            className="h-10 w-10 rounded-xl bg-[#059669] object-contain p-1.5"
          />
          <span className="text-2xl font-black tracking-tight text-[#047857]">UnifiedTree</span>
        </div>
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ECFDF5] text-[#047857]">
          <Clock size={34} />
        </div>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-[#047857]">
          Workspace pending approval
        </p>
        <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-text-primary">
          UnifiedTree administrator approval is required.
        </h1>
        <p className="mt-4 text-lg leading-8 text-text-secondary">
          Your workspace has been reserved, but module dashboards remain locked until the administrator approves
          the requested modules manually.
        </p>

        <div className="mt-8 ut-card p-5">
          <p className="text-xs font-black uppercase tracking-wide text-text-tertiary">Workspace</p>
          <p className="mt-1 text-xl font-black text-[#047857]">
            {status ? `${status.subdomain}.unifiedtree.com` : 'Loading workspace...'}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-text-tertiary">Status</p>
              <p className="font-bold text-text-primary">{status?.status || (loading ? 'Loading' : 'Unknown')}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-text-tertiary">Requested modules</p>
              <p className="font-bold text-text-primary">{status?.requestedModules?.join(', ') || '-'}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#059669] px-5 py-3 font-black text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#059669]/30"
          >
            <RefreshCcw size={17} /> Refresh status
          </button>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-xl border border-[#6EE7B7] px-5 py-3 font-black text-[#047857] transition-colors hover:bg-[#ECFDF5] focus:outline-none focus:ring-2 focus:ring-[#059669]/30"
          >
            Back to login
          </Link>
        </div>
      </section>
    </main>
  )
}
