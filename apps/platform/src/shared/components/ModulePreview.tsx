import React from 'react'
import { Construction, GitBranch, ExternalLink } from 'lucide-react'

interface ModulePreviewProps {
  /** Display name of the module, e.g. "HRMS - Employees". */
  title: string
  /** Owner the work is assigned to. */
  owner: string
  /** Brief description of what this page will eventually do. */
  description: string
  /** Optional link to the contract / README. */
  contractHref?: string
  /** The existing mock UI, rendered below the banner as a design preview. */
  children: React.ReactNode
}

/**
 * Banner shown on top of module pages whose backend wiring is not done yet.
 *
 * The mock UI below the banner stays in place as a design target for the
 * owning teammate. When real data lands, the teammate removes the
 * <ModulePreview> wrapper so the page renders as a normal route.
 */
export const ModulePreview: React.FC<ModulePreviewProps> = ({
  title, owner, description, contractHref, children,
}) => {
  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-amber-500/5 backdrop-blur">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:gap-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30">
            <Construction size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-[#0F172A]">{title}</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                <GitBranch size={10} /> Owner: {owner}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-[#334155]/90">{description}</p>
            <p className="mt-2 text-xs text-[#64748B]">
              Below is the design target. The owning teammate replaces this preview
              with real data wired to the canonical backend.
              {contractHref && (
                <>
                  {' '}
                  <a
                    href={contractHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200"
                  >
                    Module contract <ExternalLink size={11} />
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
