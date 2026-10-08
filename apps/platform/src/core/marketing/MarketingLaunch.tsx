import { Building2, Megaphone } from 'lucide-react'
import { Callout } from '@/design/kit/display'
import { Dialog, PanelButton } from '@/design/kit/overlays'
import { isRetryable, marketingErrorMessage, type MarketingCompany, type MarketingErrorCode } from './marketingLauncher'
import type { MarketingLauncher } from './useMarketingLauncher'
import '@/design/shell/shell.css'

/** The launcher's tile colours for Marketing (Modules.tsx TILE_COLORS.marketing). */
const TILE = { from: '#F472B6', to: '#DB2777', glow: 'rgba(219,39,119,0.45)' }

/** The Marketing tile in the app launcher's grid (same look as the other app tiles). */
export function MarketingAppTile({ launcher }: { launcher: Pick<MarketingLauncher, 'start' | 'busyId' | 'chooserOpen'> }) {
  const opening = !!launcher.busyId && !launcher.chooserOpen
  return (
    <button
      type="button"
      onClick={launcher.start}
      className="ut-app"
      aria-busy={opening || undefined}
      title="Marketing opens in this tab, signed in as you"
      data-app="marketing"
    >
      <span className="ut-app__icon" style={{ background: `linear-gradient(160deg, ${TILE.from} 0%, ${TILE.to} 100%)`, boxShadow: `0 12px 26px -12px ${TILE.glow}` }}>
        <Megaphone size={30} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="ut-app__label">{opening ? 'Opening Marketing…' : 'Marketing'}</span>
    </button>
  )
}

/** "Marketing" in the business frame's top bar, next to All apps. */
export function MarketingShellLink({ launcher }: { launcher: Pick<MarketingLauncher, 'start' | 'busyId' | 'chooserOpen'> }) {
  const opening = !!launcher.busyId && !launcher.chooserOpen
  return (
    <button type="button" className="ut-biz__apps ut-biz__mkt" onClick={launcher.start} aria-busy={opening || undefined}
      aria-label={opening ? 'Opening Marketing' : 'Marketing'} title="Marketing opens in this tab, signed in as you" data-app="marketing">
      <Megaphone size={16} aria-hidden="true" />
      <span>{opening ? 'Opening…' : 'Marketing'}</span>
    </button>
  )
}

interface PanelProps {
  companies: readonly MarketingCompany[]
  busyId: string | null
  error: MarketingErrorCode | null
  onPick: (companyId: string) => void
}

/** The chooser's body: which company to open Marketing for (and why the last try failed). */
export function MarketingChooserBody({ companies, busyId, error, onPick }: PanelProps) {
  return (
    <div className="ut-mkt">
      {error && <Callout tone="danger" icon="alert" live>{marketingErrorMessage(error)}</Callout>}
      <div className="ut-mkt__list" role="list">
        {companies.map((c) => (
          <div role="listitem" key={c.companyId}>
            <button type="button" className="ut-set ut-mkt__co" disabled={!!busyId} aria-busy={busyId === c.companyId || undefined} onClick={() => onPick(c.companyId)}>
              <span className="ut-set__icon"><Building2 size={18} aria-hidden="true" /></span>
              <span className="ut-set__text">
                <span className="ut-set__label">{c.name}</span>
                <span className="ut-set__desc">{busyId === c.companyId ? 'Opening…' : c.current ? 'Current company' : 'Open Marketing for this company'}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The chooser (several companies) and the "couldn't open" message (one company), as one dialog. */
export function MarketingLaunchDialog({ launcher }: { launcher: MarketingLauncher }) {
  const { chooserOpen, error, busyId, companies, launch, retry, dismiss } = launcher
  if (chooserOpen) {
    return (
      <Dialog
        open
        onClose={dismiss}
        busy={!!busyId}
        icon={<Megaphone size={18} aria-hidden="true" />}
        title="Open Marketing"
        sub="Choose the company to work in."
        footer={<PanelButton variant="secondary" onClick={dismiss} disabled={!!busyId}>Cancel</PanelButton>}
      >
        <MarketingChooserBody companies={companies} busyId={busyId} error={error} onPick={launch} />
      </Dialog>
    )
  }
  if (!error) return null
  return (
    <Dialog
      open
      onClose={dismiss}
      role="alertdialog"
      hideClose
      tone="danger"
      icon="alert"
      title="Marketing couldn’t be opened"
      footer={(
        <>
          <PanelButton variant="secondary" onClick={dismiss}>Close</PanelButton>
          {isRetryable(error) && <PanelButton variant="primary" onClick={retry}>Try again</PanelButton>}
        </>
      )}
    >
      <p className="ut-mkt__msg">{marketingErrorMessage(error)}</p>
    </Dialog>
  )
}
