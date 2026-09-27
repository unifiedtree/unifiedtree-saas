// hand-owned — rebuilt by hand on the redesign kit (F2d). Never regenerate this file.
//
// An approval request as the design's approval card (prototype TeamApprovals /
// kit ApprovalRow "card": 18px corners, hairline, the facts in a grey inset
// box), with this card's own controls kept exactly: the "Decision note" box,
// Reject and Approve. ApprovalShell is the card frame; ModuleKit's DecisionCard
// uses it too.
import type { CSSProperties, ReactNode } from 'react'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'
import { arr, txt } from './dc-runtime'
import '@/design/kit/overlays.css'
import './ApprovalCard.view.css'

export interface ApprovalShellProps {
  name?: string | null
  sub?: string
  /** The status pill (right of the name). */
  status?: ReactNode
  facts: { k: ReactNode; v: ReactNode }[]
  /** What goes under the facts: reason, when it was raised, notes, details. */
  body?: ReactNode
  /** The right-hand column (the decision controls or the actions). */
  side?: ReactNode
  /** flex of the left column (the two cards wrap at slightly different widths). */
  basis?: string
}

export function ApprovalShell({ name, sub, status, facts, body, side, basis = '1 1 220px' }: ApprovalShellProps) {
  return (
    <article className="uko-apprc dcap">
      <div style={{ flex: basis, minWidth: 0, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <HrAvatar name={name} sub={sub} />
          {status}
        </div>
        {facts.length > 0 && (
          <dl className="uko-apprc-facts" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,120px),1fr))' }}>
            {facts.map((x, i) => (
              <div key={i} className="uko-apprc-fact">
                <dt>{x.k}</dt>
                <dd>{x.v}</dd>
              </div>
            ))}
          </dl>
        )}
        {body}
      </div>
      {side}
    </article>
  )
}

const TEXT: CSSProperties = { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--u-ink2,#4A5A54)' }
const META: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }

/** The quiet grey note box ("Decision note: …"). */
export function ApprovalNote({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <p style={{ margin: 0, padding: '8px 10px', borderRadius: 10, background: 'var(--u-sf2,#F7F9F8)', border: '1px solid var(--u-ln2,#EDF1EF)', fontSize: 12.5, lineHeight: 1.45, color: 'var(--u-ink2,#4A5A54)' }}>
      <strong style={{ color: 'var(--u-ink,#0E1B16)', fontWeight: 500 }}>{label}</strong>
      {' '}{children}
    </p>
  )
}

export function ApprovalCardView({ v }: { v: any }) {
  const r = v.r || {}
  return (
    <ApprovalShell
      name={r.name}
      sub={r.sub}
      status={<HrStatusPill tone={r.tone}>{txt(r.statusLabel)}</HrStatusPill>}
      facts={arr(r.facts).map((x: any) => ({ k: txt(x?.k), v: txt(x?.v) }))}
      body={
        <>
          <p style={TEXT}>
            <span style={{ color: 'var(--u-ink3,#6A7A73)' }}>{'Reason:'}</span>
            {' '}{txt(r.reason)}
          </p>
          <div style={META}>
            <span>{'Raised '}{txt(r.raised)}</span>
            {r.hasAttachment ? (
              <button type="button" onClick={r.onAttachment} data-tip="Opens attachment preview" className="dcap-link">
                {txt(v.icFile)}{' View attachment · '}{txt(r.attachment)}
              </button>
            ) : null}
          </div>
          {r.hasNote ? <ApprovalNote label="Decision note:">{txt(r.note)}</ApprovalNote> : null}
        </>
      }
      side={r.pending ? (
        <div style={{ flex: '0 1 260px', minWidth: 0, display: 'grid', gap: 8, marginLeft: 'auto' }}>
          {v.canDecide ? (
            <>
              <textarea value={v.note} onChange={v.setNote} rows={2} maxLength={300} placeholder="Decision note (optional)" aria-label="Decision note" className="dcap-note" />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <HrButton variant="ghost" size="sm" onClick={v.reject} data-tip="Rejects this request">
                  {'Reject'}
                </HrButton>
                <HrButton size="sm" onClick={v.approve} data-tip={v.approveTip}>
                  {txt(v.approveLabel)}
                </HrButton>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    />
  )
}
