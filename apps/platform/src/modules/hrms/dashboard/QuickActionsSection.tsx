// The quick-action tiles with "Customise" (audit G-59, BW-112), shared by the admin Dashboard (surface=dashboard)
// and Home (surface=home). The page passes the tiles the person may use, in today's order (each already checked
// against its own permission); this block shows the person's saved picks (useUiPrefs) and lets them pick and
// order up to 6, or reset to the default tiles. Picks are saved per person on the server, so the phone app can
// show the same. While the preferences table isn't there (or the call fails) the default tiles show and
// Customise is hidden.
import { useState } from 'react'
import { Button, QuickActionGrid, QuickActionTile, SectionHeading, errorText, type QuickIconKind } from '@/design/kit/display'
import { Checkbox, Dialog, PanelButton, useToast } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import type { QuickActionSurface } from '../api/shared/contracts'
import { useSaveQuickActions, useUiPrefs } from '../api/shared/useUiPrefs'
import { MAX_PICKS, applyPicks, dialogOrder, movePick, picksToSave, startDraft, togglePick } from './quickPicks'
import './quickActions.css'

export interface QuickTile {
  key: string
  label: string
  hint?: string
  kind?: QuickIconKind
  /** A plain icon when the action has no scene. */
  icon?: string
  badge?: number | null
  badgeLabel?: string
  onClick: () => void
}

export function QuickActionsSection({ surface, tiles }: { surface: QuickActionSurface; tiles: readonly QuickTile[] }) {
  const prefs = useUiPrefs(surface, { enabled: tiles.length > 0 })
  const [open, setOpen] = useState(false)
  const picked = prefs.data?.picked ?? null
  const shown = applyPicks(tiles, picked)
  // Customise once the person's picks are known and there is something to choose between.
  const canCustomise = !!prefs.data && tiles.length > 1

  if (tiles.length === 0) return null
  return (
    <section aria-label="Quick actions" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHeading title="Quick actions" level={2}
        actions={canCustomise ? <Button variant="ghost" size={32} icon="settings" onClick={() => setOpen(true)}>Customise</Button> : undefined} />
      <QuickActionGrid>
        {shown.map((t, i) => (
          <QuickActionTile key={t.key} index={i} label={t.label} hint={t.hint} kind={t.kind} icon={t.kind ? undefined : (t.icon ?? 'building')}
            badge={t.badge || null} badgeLabel={t.badgeLabel} onClick={t.onClick} />
        ))}
      </QuickActionGrid>
      {open && <CustomiseDialog surface={surface} tiles={tiles} picked={picked} onClose={() => setOpen(false)} />}
    </section>
  )
}

function CustomiseDialog({ surface, tiles, picked, onClose }: {
  surface: QuickActionSurface
  tiles: readonly QuickTile[]
  picked: readonly string[] | null
  onClose: () => void
}) {
  const toast = useToast()
  const save = useSaveQuickActions(surface)
  const [draft, setDraft] = useState<string[]>(() => startDraft(tiles, picked))
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const full = draft.length >= MAX_PICKS

  const send = async (next: string[] | null, which: 'save' | 'reset') => {
    setBusy(which)
    try {
      const r = await save.mutateAsync({ picked: next })
      if (!r.available) {
        toast.info('Customising quick actions isn’t switched on yet.')
      } else {
        toast.success(which === 'reset' ? 'Quick actions are back to the default' : 'Quick actions saved')
      }
      onClose()
    } catch (e) {
      toast.error('Couldn’t save your quick actions', { detail: errorText(e, 'Try again in a moment.') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onClose={onClose} busy={busy != null} icon="settings" width={480}
      title="Customise quick actions"
      sub={`Pick up to ${MAX_PICKS} and put them in the order you want. Only actions you can use are listed.`}
      footer={(
        <>
          <PanelButton variant="secondary" onClick={() => send(null, 'reset')} busy={busy === 'reset'} disabled={busy != null || picked == null}>
            Reset to default
          </PanelButton>
          <span style={{ flex: 1 }} />
          <PanelButton variant="secondary" onClick={onClose} disabled={busy != null}>Cancel</PanelButton>
          <PanelButton variant="primary" onClick={() => send(picksToSave(tiles, draft), 'save')} busy={busy === 'save'}
            disabled={busy != null || draft.length === 0}>Save</PanelButton>
        </>
      )}>
      <p className="qa-cust__count" aria-live="polite">
        {draft.length === 0 ? 'Pick at least one.' : `${draft.length} of ${MAX_PICKS} picked${full ? ' · untick one to pick another' : ''}`}
      </p>
      <ol className="qa-cust__list">
        {dialogOrder(tiles, draft).map((t) => {
          const at = draft.indexOf(t.key)
          const on = at >= 0
          return (
            <li key={t.key} className="qa-cust__row" data-on={on ? '' : undefined}>
              <Checkbox checked={on} disabled={!on && full} label={t.label} onChange={() => setDraft((d) => togglePick(d, t.key))} />
              {on && (
                <span className="qa-cust__move">
                  <Button variant="ghost" size={30} aria-label={`Move ${t.label} up`} disabled={at === 0}
                    icon={<span className="qa-cust__up">{dashIcon('chevronDown', 16)}</span>}
                    onClick={() => setDraft((d) => movePick(d, t.key, -1))} />
                  <Button variant="ghost" size={30} aria-label={`Move ${t.label} down`} disabled={at === draft.length - 1}
                    icon={dashIcon('chevronDown', 16)} onClick={() => setDraft((d) => movePick(d, t.key, 1))} />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </Dialog>
  )
}
