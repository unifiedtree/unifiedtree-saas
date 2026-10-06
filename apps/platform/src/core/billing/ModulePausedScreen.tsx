// The "Payment needed" screen: a module paused after the payment grace (modulePaused.ts). Shown in place of
// the page; the top bar, sign-out and the plan / billing pages stay reachable.
//   - canPay (the billing permission): "Pay now" opens the plan page
//   - everyone else: "Ask your business owner to pay"
import { useEffect, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button } from '@/design/kit/Button'
import { fmtShort } from '@/design/dc/dates'
import { clearModulePaused, dueText, moduleName, openWhilePaused, useModulePaused, type ModulePaused } from './modulePaused'

export function ModulePausedScreen({ paused, onPay, onRetry }: { paused: ModulePaused; onPay: () => void; onRetry: () => void }) {
  const name = moduleName(paused.moduleKey)
  const amount = dueText(paused.dueAmountInr)
  const facts = [
    amount ? `Amount due: ${amount}` : '',
    paused.dueSince ? `Due since ${fmtShort(paused.dueSince)}` : '',
    paused.graceEndedOn ? `Grace period ended ${fmtShort(paused.graceEndedOn)}` : '',
  ].filter(Boolean)
  return (
    <div role="alert" data-testid="module-paused" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: '32px 16px' }}>
      <div className="ut-card" style={{ maxWidth: 520, width: '100%', padding: 28, display: 'grid', gap: 14, textAlign: 'center', justifyItems: 'center' }}>
        <span aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--u-ams,#FEF3C7)', color: 'var(--u-amt,#92400E)', fontSize: 22, fontWeight: 700 }}>₹</span>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--u-amt,#92400E)' }}>Payment needed</span>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--u-ink,#0E1B16)' }}>{name} is paused</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--u-ink2,#4A5A54)' }}>
          {paused.message || `${name} is paused because a payment wasn’t received.`}
        </p>
        {facts.length > 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>{facts.join(' · ')}</p>}
        {paused.canPay
          ? <p style={{ margin: 0, fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>{name} opens again as soon as the payment is received.</p>
          : <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--u-ink,#0E1B16)' }}>Ask your business owner to pay. {name} opens again as soon as they do.</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          {paused.canPay && <Button variant="primary" size={40} onClick={onPay}>Pay now</Button>}
          <Button variant="secondary" size={40} onClick={onRetry}>Try again</Button>
        </div>
      </div>
    </div>
  )
}

/** Wraps the shell's page: the payment-needed screen while a module is paused, the page otherwise. */
export function ModulePausedGate({ children }: { children: ReactNode }) {
  const paused = useModulePaused()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // The older 402 body doesn't say who may pay: the billing permission decides (as the Billing & plan page).
  const mayPay = usePermission(P.WORKSPACE_BILLING_MANAGE)
  // Another page: ask again (if it is still unpaid, its first call reports it again).
  useEffect(() => { clearModulePaused() }, [pathname])
  if (!paused || openWhilePaused(pathname)) return <>{children}</>
  const shown = paused.legacy ? { ...paused, canPay: mayPay } : paused
  return <ModulePausedScreen paused={shown} onPay={() => navigate('/plan')} onRetry={() => { clearModulePaused(); window.location.reload() }} />
}
