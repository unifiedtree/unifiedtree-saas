// The workspace's own mark, wherever the app used to show the vendor's.
// Image first (square mark, then wide logo), else a monogram tile: the first
// letter of the workspace name in the app's existing colours.
import { useState } from 'react'
import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'

/**
 * Letter tile. `tone` picks the existing palette of the surface it sits on:
 * light = the auth cards' emerald tile, ground = the splash's gradient.
 */
export function MonogramTile({ letter, size, tone = 'light', radius }: { letter: string; size: number; tone?: 'light' | 'ground'; radius?: number }) {
  const ground = tone === 'ground'
  return (
    <span aria-hidden="true"
      style={{
        width: size, height: size, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: radius ?? Math.round(size * 0.3),
        background: ground ? 'rgba(255,255,255,0.62)' : '#059669',
        color: ground ? '#04503A' : '#fff',
        fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontWeight: 800, fontSize: Math.round(size * 0.5), lineHeight: 1,
        boxShadow: ground ? '0 1px 2px rgba(4,80,58,.12)' : undefined,
      }}>
      {letter}
    </span>
  )
}

/** Square slot: mark, else logo (contained), else the monogram tile. */
export function WorkspaceMark({ size, tone = 'light', preferLogo = false }: { size: number; tone?: 'light' | 'ground'; preferLogo?: boolean }) {
  const b = useWorkspaceBranding()
  const [failed, setFailed] = useState<string | null>(null)
  const src = (preferLogo ? b.logoUrl || b.markUrl : b.markUrl || b.logoUrl) || null
  if (src && failed !== src) {
    return (
      <img src={src} alt={b.workspaceName ? `${b.workspaceName} logo` : ''} onError={() => setFailed(src)}
        style={{ height: size, maxWidth: preferLogo ? size * 4 : size, width: 'auto', objectFit: 'contain', display: 'block' }} />
    )
  }
  return <MonogramTile letter={b.monogram} size={size} tone={tone} />
}

/**
 * The block at the top of the signed-out cards (reset password, accept
 * invite, pending approval): tile + name. On a workspace host it is the
 * workspace's; on the bare platform host it stays the platform's.
 */
export function WorkspaceWordmark({ textClassName = 'text-slate-900' }: { textClassName?: string }) {
  const b = useWorkspaceBranding()
  const name = b.isWorkspace ? (b.workspaceName ?? '') : 'UnifiedTree'
  return (
    <div className="flex items-center gap-2.5 mb-8">
      {b.isWorkspace && (b.markUrl || b.logoUrl)
        ? <WorkspaceMark size={40} />
        : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#059669]">
            <span className="text-xl font-black text-white">{b.isWorkspace ? b.monogram : 'U'}</span>
          </div>
        )}
      <span className={`text-xl font-black tracking-tight ${textClassName} truncate`}>{name}</span>
    </div>
  )
}
