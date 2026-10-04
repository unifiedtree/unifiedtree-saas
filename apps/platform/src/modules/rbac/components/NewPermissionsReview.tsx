// "3 new permissions available — Review" on Roles & permissions (V143.69).
//
// New permissions are given to the built-in roles only. A role a business made
// itself gets nothing automatically (nobody can know what it is for), so its
// admin is told here and decides: tick the ones the role should have — saved
// through the same role-permissions call as the permissions drawer, with the
// same high-risk confirmation — and the role is marked as reviewed, so the
// notice goes until another permission is added.
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Callout, ErrorState, SkeletonList, StatusPill, errorText, type StatusTone } from '@/design/kit/display'
import { Checkbox, Dialog, PanelButton, SidePanel } from '@/design/kit/overlays'
import {
  useMarkRoleReviewed, useRoleNewPermissions, useRolePermissions, useSetRolePermissions,
  isRisky, RISK_LABEL, type NewRolePermission, type RbacRole, type RiskLevel,
} from '../api/useRbac'

const RISK_PILL: Record<RiskLevel, StatusTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' }

const newPermissions = (n: number) => (n === 1 ? '1 new permission' : `${n} new permissions`)

/** The set to save: saving replaces the role's whole set, so it is what the role holds now plus the ticked ones. */
export function withTicked(held: readonly string[], ticked: Iterable<string>): string[] {
  return [...new Set([...held, ...ticked])]
}

/** The small notice under a business-made role's name. */
export function NewPermissionsNotice({ count, roleName, onReview }: { count: number; roleName: string; onReview: () => void }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <StatusPill tone="info" size="xs" dot>{`${newPermissions(count)} available`}</StatusPill>
      <Button variant="ghost" size={30} aria-label={`Review new permissions for ${roleName}`}
        onClick={(e) => { e.stopPropagation(); onReview() }}>
        Review
      </Button>
    </span>
  )
}

/** Review a role's new permissions: tick the ones it should have, then mark it as reviewed. */
export function NewPermissionsReview({ role, onClose }: { role: RbacRole; onClose: () => void }) {
  const list = useRoleNewPermissions(role.id)
  const held = useRolePermissions(role.id)
  const setPerms = useSetRolePermissions(role.id)
  const markReviewed = useMarkRoleReviewed()
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [confirmRisky, setConfirmRisky] = useState<NewRolePermission[] | null>(null)
  const perms = list.data ?? []
  const busy = setPerms.isPending || markReviewed.isPending

  const toggle = (code: string, on: boolean) => setTicked((prev) => {
    const next = new Set(prev)
    if (on) next.add(code)
    else next.delete(code)
    return next
  })

  const finish = (added: number) => markReviewed.mutate(role.id, {
    onSuccess: () => {
      toast.success(added ? `${added} added to ${role.displayName}, and the role is marked as reviewed` : `${role.displayName} is marked as reviewed`)
      onClose()
    },
    onError: (e) => toast.error(added ? 'The permissions were added, but the role couldn’t be marked as reviewed' : 'Couldn’t mark the role as reviewed',
      { description: errorText(e, 'Please try again.') }),
  })

  const add = (acknowledgeRisk: boolean) => {
    setPerms.mutate({ codes: withTicked(held.data ?? [], ticked), acknowledgeRisk }, {
      onSuccess: () => { setConfirmRisky(null); finish(ticked.size) },
      onError: (e) => { setConfirmRisky(null); toast.error('Couldn’t add the permissions', { description: errorText(e, 'Please try again.') }) },
    })
  }

  const submit = () => {
    if (ticked.size === 0) { finish(0); return }
    const risky = perms.filter((p) => ticked.has(p.code) && isRisky(p.riskLevel))
    if (risky.length) { setConfirmRisky(risky); return }
    add(false)
  }

  // Nothing to mark until the list has been seen, and never save before the role's
  // current permissions are known: the save replaces them.
  const blocked = list.isLoading ? 'Loading…'
    : list.isError ? 'Couldn’t load the new permissions'
    : ticked.size > 0 && !held.isSuccess
      ? (held.isError ? 'Couldn’t load what this role already has. Close this and try again.' : 'Loading what this role already has…')
      : null

  return (
    <>
      <SidePanel open onClose={onClose} title="New permissions" sub={role.displayName} busy={busy}
        footer={(
          <>
            <PanelButton size="lg" onClick={onClose}>Cancel</PanelButton>
            <PanelButton size="lg" variant="primary" busy={busy} blockedReason={blocked} tipAlign="end" onClick={submit}>
              {ticked.size ? `Add ${ticked.size} and mark as reviewed` : 'Mark as reviewed'}
            </PanelButton>
          </>
        )}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Callout tone="info">
            New permissions are given to the built-in roles automatically, but not to roles your business made.
            Tick the ones {role.displayName} should have. Marking it as reviewed hides this until more are added.
          </Callout>
          {list.isLoading ? (
            <SkeletonList rows={3} avatar={false} label="Loading new permissions" />
          ) : list.isError ? (
            <ErrorState title="Couldn’t load the new permissions" error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
          ) : perms.length === 0 ? (
            <Callout tone="neutral">Nothing new to review for this role.</Callout>
          ) : (
            perms.map((p) => (
              <Checkbox key={p.code} card full checked={ticked.has(p.code)} disabled={busy}
                onChange={(on) => toggle(p.code, on)}
                label={(
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    {p.displayName}
                    {p.riskLevel && p.riskLevel !== 'LOW' && <StatusPill tone={RISK_PILL[p.riskLevel]} size="xs">{RISK_LABEL[p.riskLevel]}</StatusPill>}
                  </span>
                )}
                description={(
                  <>
                    {p.description ?? p.code}
                    {isRisky(p.riskLevel) && p.warning && <span style={{ display: 'block' }}>{p.warning}</span>}
                  </>
                )} />
            ))
          )}
        </div>
      </SidePanel>
      <Dialog open={!!confirmRisky} onClose={() => setConfirmRisky(null)} busy={setPerms.isPending} tone="warning" icon="alertTriangle"
        title="Add high-risk permissions?" sub={`Everyone who holds ${role.displayName} gets these. Please read before confirming.`}
        footer={(
          <>
            <PanelButton onClick={() => setConfirmRisky(null)}>Cancel</PanelButton>
            <PanelButton variant="danger" busy={setPerms.isPending} onClick={() => add(true)}>Yes, add them</PanelButton>
          </>
        )}>
        <div style={{ display: 'grid', gap: 8 }}>
          {confirmRisky?.map((p) => (
            <Callout key={p.code} tone={p.riskLevel === 'CRITICAL' ? 'danger' : 'warning'} icon={null}>
              <strong>{p.displayName}</strong> ({RISK_LABEL[p.riskLevel]}): {p.warning ?? p.description}
            </Callout>
          ))}
        </div>
      </Dialog>
    </>
  )
}
