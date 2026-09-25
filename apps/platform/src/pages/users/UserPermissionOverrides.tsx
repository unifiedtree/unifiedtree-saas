// Manage access → "Extra and removed permissions" for one person (V143.17).
//
// Two people can share a role and still need different access (the client's
// two department managers). An admin gives this one person an extra permission
// or takes one away, with a reason and an optional end date, instead of
// making a one-off role. The server applies the levels rules (never your own
// access, only what you hold, critical ones only by the owner), asks for the
// warning to be confirmed on high-risk grants, and audits every change.
//   GET/PUT /v1/workspace/users/{id}/permissions · catalogue: /v1/rbac/permissions
// Built only from kit parts: SubHeading, Note, RowList/Row, HrButton,
// HrStatusPill, HrSelect, the ui-kit Field/Input/Modal and the ut-input class.
import React, { useMemo, useState } from 'react'
import { Modal, Field, Input } from '@unifiedtree/ui-kit'
import { HrButton, HrStatusPill, HrSelect } from '@/shared/components/hr'
import { SubHeading, Note, RowList, Row, dmy, todayIso } from '@/design/module/ModuleKit'
import { usePermissionsCatalogue, RISK_LABEL, RISK_TONE, isRisky, type RbacPermission, type RiskLevel } from '@/modules/rbac/api/useRbac'
import {
  useSaveUserPermissions,
  type UserPermissionsView, type OverrideInput, type OverrideEffect, type PermissionOverride,
} from '@/modules/rbac/api/useWorkspaceAccess'

interface Props {
  view: UserPermissionsView
  userName: string
  onDone: (message: string, error?: string) => void
}

type Pending = { overrides: OverrideInput[]; risky: { code: string; name: string; risk: RiskLevel; warning: string | null }[]; done: string }

const EFFECT_OPTIONS = [
  { value: 'GRANT', label: 'Give an extra permission' },
  { value: 'DENY', label: 'Remove a permission' },
]

/** End of the chosen day in the browser's calendar (India for our users), as an instant. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString()
const asInput = (o: PermissionOverride): OverrideInput => ({ permissionCode: o.permissionCode, effect: o.effect, reason: o.reason, expiresAt: o.expiresAt })

export function UserPermissionOverrides({ view, userName, onDone }: Props) {
  const { data: catalogue = [], isLoading: catalogueLoading } = usePermissionsCatalogue()
  const save = useSaveUserPermissions(view.userId)
  const [effect, setEffect] = useState<OverrideEffect>('GRANT')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [effectiveQuery, setEffectiveQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const byCode = useMemo(() => new Map(catalogue.map((p) => [p.code, p])), [catalogue])
  const effectiveCodes = useMemo(() => new Set(view.effective.map((e) => e.code)), [view.effective])
  const overridden = useMemo(() => new Set(view.overrides.map((o) => o.permissionCode)), [view.overrides])
  const grantable = useMemo(() => new Set(view.grantable), [view.grantable])

  // Give: what they don't have yet. Remove: what they have now.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalogue
      .filter((p) => !p.code.startsWith('platform.') && !overridden.has(p.code))
      .filter((p) => (effect === 'GRANT' ? !effectiveCodes.has(p.code) : effectiveCodes.has(p.code)))
      .filter((p) => !q || p.code.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [catalogue, query, effect, effectiveCodes, overridden])

  const blockedWhy = (p: RbacPermission): string | null => {
    if (effect !== 'GRANT' || grantable.has(p.code)) return null
    return p.riskLevel === 'CRITICAL' ? 'Only the workspace owner can give critical permissions.' : 'You can only give permissions you hold yourself.'
  }

  const current = view.overrides.map(asInput)
  const pickedPerm = picked ? byCode.get(picked) : undefined

  const submit = (overrides: OverrideInput[], restored: string[], done: string) => {
    const risky = restored.map((code) => byCode.get(code)).filter((p): p is RbacPermission => !!p && isRisky(p.riskLevel))
      .map((p) => ({ code: p.code, name: p.displayName, risk: p.riskLevel, warning: p.warning }))
    if (risky.length) { setPending({ overrides, risky, done }); return }
    run(overrides, false, done)
  }

  const run = (overrides: OverrideInput[], acknowledgeRisk: boolean, done: string) => {
    save.mutate({ overrides, acknowledgeRisk }, {
      onSuccess: () => {
        setPending(null); setPicked(null); setReason(''); setUntil(''); setQuery('')
        onDone(done)
      },
      onError: (e) => { setPending(null); onDone('Couldn’t save the change', (e as Error).message) },
    })
  }

  const add = () => {
    if (!pickedPerm) return
    if (!reason.trim()) { onDone('Please give a reason', 'The reason is kept with the change and in the audit log.'); return }
    if (until && until < todayIso()) { onDone('Pick an end date from today on', 'Leave it empty to keep the change until someone removes it.'); return }
    const next: OverrideInput = { permissionCode: pickedPerm.code, effect, reason: reason.trim(), expiresAt: until ? endOfDay(until) : null }
    submit([...current, next], effect === 'GRANT' ? [pickedPerm.code] : [],
      effect === 'GRANT' ? `${pickedPerm.displayName} given to ${userName}` : `${pickedPerm.displayName} removed from ${userName}`)
  }

  const clear = (o: PermissionOverride) => {
    // Clearing a "removed" override gives the permission back, so it is checked like a grant.
    submit(current.filter((c) => c.permissionCode !== o.permissionCode), o.effect === 'DENY' ? [o.permissionCode] : [],
      o.effect === 'GRANT' ? `Extra permission ${o.displayName} cleared` : `${o.displayName} given back to ${userName}`)
  }

  const shownEffective = useMemo(() => {
    const q = effectiveQuery.trim().toLowerCase()
    const list = view.effective.filter((e) => !q || e.code.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q) || e.sources.join(' ').toLowerCase().includes(q))
    return showAll || q ? list : list.slice(0, 10)
  }, [view.effective, effectiveQuery, showAll])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <SubHeading aside={<HrStatusPill tone="gray">{view.overrides.length} set</HrStatusPill>}>Extra and removed permissions</SubHeading>
      <Note>
        Give {userName} something their roles don’t, or take something away, without changing the role for everyone else.
        A reason is required; add an end date for temporary access. Changes reach their app the next time they sign in.
      </Note>
      {!view.canEdit && view.editBlockedReason && <Note tone="amber">{view.editBlockedReason}</Note>}

      {view.overrides.length > 0 ? (
        <RowList>
          {view.overrides.map((o) => (
            <Row key={o.permissionCode} muted={o.expired}
              title={o.displayName}
              meta={`${o.permissionCode} · ${o.reason}${o.expiresAt ? ` · ${o.expired ? 'ended' : 'until'} ${dmy(o.expiresAt)}` : ''}${o.grantedByEmail ? ` · by ${o.grantedByEmail}` : ''}`}
              trail={<>
                {o.expired ? <HrStatusPill tone="gray">Ended</HrStatusPill>
                  : <HrStatusPill tone={o.effect === 'GRANT' ? 'ok' : 'red'}>{o.effect === 'GRANT' ? 'Extra' : 'Removed'}</HrStatusPill>}
                {isRisky(o.riskLevel) && <HrStatusPill tone={RISK_TONE[o.riskLevel]}>{RISK_LABEL[o.riskLevel]}</HrStatusPill>}
                {view.canEdit && <HrButton size="sm" variant="ghost" disabled={save.isPending} onClick={() => clear(o)}>{o.effect === 'GRANT' ? 'Clear' : 'Give back'}</HrButton>}
              </>}
            />
          ))}
        </RowList>
      ) : <Note>No individual changes: {userName} has exactly what their roles give.</Note>}

      {view.canEdit && (
        <div style={{ display: 'grid', gap: 12 }}>
          <HrSelect value={effect} onChange={(v) => { setEffect(v as OverrideEffect); setPicked(null) }} options={EFFECT_OPTIONS} />
          <Field label={effect === 'GRANT' ? 'Find a permission to give' : 'Find a permission to remove'}>
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null) }} placeholder="Search by name, code or what it does" aria-label="Search permissions" />
          </Field>
          {catalogueLoading ? <Note>Loading the permission list…</Note> : !pickedPerm && (
            candidates.length === 0 ? <Note>{effect === 'GRANT' ? 'Nothing to add matches. They may already have it.' : 'Nothing they have matches.'}</Note> : (
              <RowList>
                {candidates.map((p) => {
                  const blocked = blockedWhy(p)
                  return (
                    <Row key={p.code} muted={!!blocked} onClick={blocked ? undefined : () => setPicked(p.code)}
                      title={p.displayName}
                      meta={`${p.code}${p.description ? ` · ${p.description}` : ''}`}
                      note={blocked ?? undefined}
                      trail={p.riskLevel !== 'LOW' ? <HrStatusPill tone={RISK_TONE[p.riskLevel]}>{RISK_LABEL[p.riskLevel]}</HrStatusPill> : undefined}
                    />
                  )
                })}
              </RowList>
            )
          )}
          {pickedPerm && (
            <div style={{ display: 'grid', gap: 12 }}>
              <RowList>
                <Row title={pickedPerm.displayName} meta={`${pickedPerm.code}${pickedPerm.description ? ` · ${pickedPerm.description}` : ''}`}
                  trail={<HrButton size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</HrButton>} />
              </RowList>
              {effect === 'GRANT' && isRisky(pickedPerm.riskLevel) && (
                <Note tone={pickedPerm.riskLevel === 'CRITICAL' ? 'red' : 'amber'}>{RISK_LABEL[pickedPerm.riskLevel]}: {pickedPerm.warning ?? 'This permission is sensitive.'}</Note>
              )}
              <Field label="Reason" required hint="Kept with the change and in the audit log.">
                <textarea className="ut-input resize-y" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={effect === 'GRANT' ? 'e.g. Covers payroll while the finance lead is on leave' : 'e.g. Should not approve advances for their own team'} aria-label="Reason" />
              </Field>
              <Field label="End date (optional)" hint="Leave empty to keep it until someone removes it.">
                <Input type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="End date" />
              </Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <HrButton variant="ghost" onClick={() => { setPicked(null); setReason(''); setUntil('') }}>Cancel</HrButton>
                <HrButton disabled={save.isPending || !reason.trim()} onClick={add}>{effect === 'GRANT' ? 'Give permission' : 'Remove permission'}</HrButton>
              </div>
            </div>
          )}
        </div>
      )}

      <SubHeading aside={<HrStatusPill tone="info">{view.effective.length}</HrStatusPill>}>What {userName} can do</SubHeading>
      <Note>Every permission they end up with and where it comes from: a role, being an employee, or an extra permission given to them.</Note>
      <Input value={effectiveQuery} onChange={(e) => setEffectiveQuery(e.target.value)} placeholder="Search their permissions" aria-label="Search their permissions" />
      <RowList>
        {shownEffective.map((e) => (
          <Row key={e.code} title={e.displayName} meta={`${e.code} · ${e.sources.join(' · ')}`}
            trail={isRisky(e.riskLevel) ? <HrStatusPill tone={RISK_TONE[e.riskLevel]}>{RISK_LABEL[e.riskLevel]}</HrStatusPill> : undefined} />
        ))}
      </RowList>
      {!effectiveQuery && view.effective.length > 10 && (
        <div><HrButton size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${view.effective.length}`}</HrButton></div>
      )}
      {view.removed.length > 0 && (
        <>
          <SubHeading>Removed for {userName}</SubHeading>
          <RowList>
            {view.removed.map((e) => (
              <Row key={e.code} muted title={e.displayName} meta={`${e.code} · would come from ${e.sources.join(' · ')}`}
                trail={<HrStatusPill tone="red">Removed</HrStatusPill>} />
            ))}
          </RowList>
        </>
      )}

      {pending && (
        <Modal open onOpenChange={(o) => { if (!o) setPending(null) }} title="Give a high-risk permission?"
          description={`${userName} will be able to do the following. Please read before confirming.`} size="sm">
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.risky.map((r) => (
              <Note key={r.code} tone={r.risk === 'CRITICAL' ? 'red' : 'amber'}><strong>{r.name}</strong> ({RISK_LABEL[r.risk]}): {r.warning ?? 'This permission is sensitive.'}</Note>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <HrButton variant="ghost" onClick={() => setPending(null)}>Cancel</HrButton>
              <HrButton variant="danger" disabled={save.isPending} onClick={() => run(pending.overrides, true, pending.done)}>Yes, give it</HrButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

