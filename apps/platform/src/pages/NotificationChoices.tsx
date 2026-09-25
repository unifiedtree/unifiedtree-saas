// Per-event notification choices (Workspace Settings → Notifications and the
// Profile page). Three lists built from the settings kit — email, in the app
// (the bell / mobile Alerts tab) and phone push — each row one event from
// GET /v1/me/notification-preferences. Changes are a draft saved through the
// page's unsaved-changes bar (PUT /v1/me/notification-preferences, only what
// changed). Always-sent events are shown switched on and locked.
import React, { useEffect, useMemo, useState } from 'react'
import { SettingsSection, SettingsToggleRow, SettingsNote } from '@/design/settings/SettingsKit'
import {
  useNotificationPreferences, useSaveNotificationPreferences,
  type ChannelField, type DeliveryChannel, type NotificationPreferences, type NotificationPreferencesPatch,
} from '@/shared/hooks/useNotificationPreferences'

interface Draft {
  emailEnabled: boolean
  pushEnabled: boolean
  events: Record<string, Partial<Record<ChannelField, boolean>>>
}

const toDraft = (p: NotificationPreferences): Draft => ({
  emailEnabled: p.emailEnabled,
  pushEnabled: p.pushEnabled,
  events: Object.fromEntries(p.events.map((e) => [e.key, {
    ...(e.inApp !== null ? { inApp: e.inApp } : {}),
    ...(e.push !== null ? { push: e.push } : {}),
    ...(e.email !== null ? { email: e.email } : {}),
  }])),
})

/** Only what differs from the saved choices (always-sent events are never sent back). */
function diff(saved: NotificationPreferences | undefined, draft: Draft | null): { patch: NotificationPreferencesPatch; count: number } {
  const patch: NotificationPreferencesPatch = {}
  let count = 0
  if (!saved || !draft) return { patch, count }
  if (draft.emailEnabled !== saved.emailEnabled) { patch.emailEnabled = draft.emailEnabled; count++ }
  if (draft.pushEnabled !== saved.pushEnabled) { patch.pushEnabled = draft.pushEnabled; count++ }
  for (const e of saved.events) {
    if (e.essential) continue
    const d = draft.events[e.key] ?? {}
    for (const f of ['inApp', 'push', 'email'] as ChannelField[]) {
      const was = e[f]
      if (was === null || d[f] === undefined || d[f] === was) continue
      patch.events = patch.events ?? {}
      patch.events[e.key] = { ...patch.events[e.key], [f]: d[f] }
      count++
    }
  }
  return { patch, count }
}

/** Draft state for the signed-in person's choices; the page wires it to its unsaved bar. */
export function useNotificationChoices(enabled = true) {
  const query = useNotificationPreferences(enabled)
  const saveMut = useSaveNotificationPreferences()
  const [draft, setDraft] = useState<Draft | null>(null)
  const { patch, count } = useMemo(() => diff(query.data, draft), [query.data, draft])
  // Seed from the server, and follow it (e.g. a save) as long as nothing is unsaved.
  useEffect(() => {
    if (query.data && (draft === null || count === 0)) setDraft(toDraft(query.data))
  }, [query.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    data: query.data,
    status: (query.isLoading ? 'loading' : query.isError ? 'error' : 'live') as 'loading' | 'error' | 'live',
    error: query.error as Error | null,
    refetch: () => { void query.refetch() },
    draft,
    dirty: count > 0,
    changeCount: count,
    saving: saveMut.isPending,
    setMaster: (k: 'emailEnabled' | 'pushEnabled', v: boolean) => setDraft((d) => (d ? { ...d, [k]: v } : d)),
    setEvent: (key: string, f: ChannelField, v: boolean) =>
      setDraft((d) => (d ? { ...d, events: { ...d.events, [key]: { ...d.events[key], [f]: v } } } : d)),
    discard: () => { if (query.data) setDraft(toDraft(query.data)) },
    save: async () => {
      if (count === 0) return
      const fresh = await saveMut.mutateAsync(patch)
      setDraft(toDraft(fresh))
    },
  }
}

export type NotificationChoicesState = ReturnType<typeof useNotificationChoices>

const ALWAYS_SENT = 'Password reset and invitation emails, billing alerts for admins and letters HR sends you always reach you, whatever you choose here.'

/**
 * The three lists. `masters`: show the email / push master switches on the
 * section headers (Workspace Settings). The Profile page has its own master
 * rows, so it passes false.
 */
export function NotificationChoiceSections({ c, email, masters }: { c: NotificationChoicesState; email?: string; masters: boolean }) {
  const { data, draft } = c
  if (!data || !draft) return null
  const rows = (channel: DeliveryChannel, f: ChannelField) => data.events
    .filter((e) => e.channels.includes(channel))
    .map((e) => (
      <SettingsToggleRow key={`${channel}-${e.key}`} label={e.label} detail={e.description}
        on={e.essential ? true : !!draft.events[e.key]?.[f]} disabled={e.essential}
        onToggle={() => c.setEvent(e.key, f, !draft.events[e.key]?.[f])} />
    ))
  const emailSummary = draft.emailEnabled
    ? `Sent to ${email || 'the address you sign in with'}. Events other than reminders email you only if you switch them on here.`
    : 'Off: only the emails that are always sent reach you.'
  const pushSummary = draft.pushEnabled
    ? 'Alerts on your phone from the mobile app, event by event.'
    : 'Off: nothing is pushed to your phone except billing alerts for admins.'
  return (
    <>
      <SettingsSection id="email" icon="inbox" title="Email choices" summary={emailSummary}
        {...(masters ? { on: draft.emailEnabled, onToggle: () => c.setMaster('emailEnabled', !draft.emailEnabled) } : {})}>
        <SettingsNote>{ALWAYS_SENT}</SettingsNote>
        {!masters && !draft.emailEnabled && <SettingsNote tone="amber">Email notifications are off above, so these choices apply only when you switch email back on.</SettingsNote>}
        {rows('EMAIL', 'email')}
      </SettingsSection>
      <SettingsSection id="inapp" icon="bell" title="In-app choices" summary="What appears in the bell here and in the Alerts tab of the mobile app.">
        <SettingsNote tone="amber">If you approve requests, switching off an approval alert means you only see new requests when you open Approvals.</SettingsNote>
        {rows('IN_APP', 'inApp')}
      </SettingsSection>
      <SettingsSection id="push" icon="smartphone" title="Phone push choices" summary={pushSummary}
        {...(masters ? { on: draft.pushEnabled, onToggle: () => c.setMaster('pushEnabled', !draft.pushEnabled) } : {})}>
        {!masters && !draft.pushEnabled && <SettingsNote tone="amber">Push notifications are off above, so these choices apply only when you switch push back on.</SettingsNote>}
        {rows('PUSH', 'push')}
      </SettingsSection>
    </>
  )
}
