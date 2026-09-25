// Workspace Settings -> Security (/settings/security): password reset email,
// two-factor sign-in (TOTP), signed-in sessions, and, for people holding
// workspace.security.manage, the workspace rule that makes two-factor
// compulsory. Built only from the settings kit (design/settings/SettingsKit).
import React, { useState } from 'react'
import { Check, Copy, Download, Monitor, Smartphone } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson } from '@/core/api/client'
import { HrButton, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { SettingsPage, SettingsSection, SettingsGrid, SettingsInput, SettingsValue, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import {
  ago, dayIst, saveText, useMfaActions, useMfaStatus, useSecurityMembers, useSessionActions, useSessions,
  useWorkspaceSecurity, useWorkspaceSecurityActions, whenIst, type MfaPolicy, type MfaSetupInfo, type MfaStatus,
} from './workspaceSettingsApi'

type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void

const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,monospace"
const ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }

const POLICY_LABEL: Record<MfaPolicy, string> = {
  OFF: 'Optional for everyone',
  ADMINS: 'Required for admins and HR',
  EVERYONE: 'Required for everyone',
}
const POLICY_DETAIL: Record<MfaPolicy, string> = {
  OFF: 'Anyone can turn two-factor on for themselves. Nobody is made to.',
  ADMINS: 'Owners, super admins, admins, HR managers and finance leads must use two-factor when they sign in with a password. Custom roles are not included; choose everyone to cover them.',
  EVERYONE: 'Everyone must use two-factor when they sign in with a password.',
}

const msg = (e: unknown) => (e as Error)?.message || 'Please try again.'

/** Password: the reset email (unchanged from before). */
const PasswordSection: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const sendReset = async () => {
    if (!user?.email) return
    setSending(true)
    try {
      await apiJson('/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: user.email }) })
    } catch {
      // Deliberately soft: forgot-password never says whether an address exists.
    } finally { setSent(true); setSending(false) }
  }
  return (
    <SettingsSection id="password" icon="lock" title="Password" summary={`We email a secure reset link to ${user?.email ?? 'your address'}. It expires shortly after it’s sent.`}>
      {sent
        ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px solid #6ee7b7', background: '#ecfdf5', color: '#047857', fontSize: 13.5, fontWeight: 600 }}><Check size={15} className="shrink-0" />Reset link sent. Check your inbox (and spam folder).</div>
        : <div><HrButton onClick={sendReset} disabled={sending || !user?.email}>{sending ? 'Sending…' : 'Email me a password reset link'}</HrButton></div>}
    </SettingsSection>
  )
}

/** Ten one-time codes, shown once, with copy and download. */
export const RecoveryCodes: React.FC<{ codes: string[]; label: string; onDone: () => void; show: Show }> = ({ codes, label, onDone, show }) => {
  const text = `${label}\nRecovery codes (each works once):\n\n${codes.join('\n')}\n`
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <SettingsNote tone="amber"><strong>Save these recovery codes now.</strong> If you lose your phone, each code signs you in once instead of the 6-digit code. They are shown only this once; keep them somewhere safe that isn’t your phone.</SettingsNote>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, padding: 14, borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }}>
        {codes.map((c) => <span key={c} style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, letterSpacing: '.04em' }}>{c}</span>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <HrButton variant="ghost" onClick={() => { void navigator.clipboard?.writeText(codes.join('\n')).then(() => show('ok', 'Codes copied')).catch(() => show('error', 'Couldn’t copy', 'Select the codes and copy them instead.')) }}><Copy size={14} className="mr-1.5" />Copy codes</HrButton>
        <HrButton variant="ghost" onClick={() => saveText('recovery-codes.txt', text)}><Download size={14} className="mr-1.5" />Download as text</HrButton>
        <HrButton onClick={onDone}>I’ve saved them</HrButton>
      </div>
    </div>
  )
}

/** The QR code + setup key an authenticator app reads. */
export const SetupKey: React.FC<{ info: MfaSetupInfo }> = ({ info }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
    <div style={{ flex: '0 0 auto', width: 176, height: 176, borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`} alt="QR code to scan with your authenticator app" width={164} height={164} />
    </div>
    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 8, fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
      <span>1. Open Google Authenticator, Microsoft Authenticator, Authy or a similar app and add an account.</span>
      <span>2. Scan this code. Can’t scan? Choose “enter a setup key” and type:</span>
      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: '#0f172a', letterSpacing: '.06em', overflowWrap: 'anywhere' }}>{info.secret.match(/.{1,4}/g)?.join(' ')}</span>
      <span>3. Type the 6-digit code the app shows for <strong>{info.issuer}</strong> below.</span>
    </div>
  </div>
)

const TwoFactorSection: React.FC<{ status?: MfaStatus; show: Show }> = ({ status, show }) => {
  const a = useMfaActions()
  const [mode, setMode] = useState<'idle' | 'setup' | 'codes' | 'disable' | 'regenerate'>('idle')
  const [info, setInfo] = useState<MfaSetupInfo | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const reset = () => { setMode('idle'); setCode(''); setInfo(null) }

  const start = () => a.setup.mutate(undefined, {
    onSuccess: (i) => { setInfo(i); setCode(''); setMode('setup') },
    onError: (e) => show('error', 'Couldn’t start set-up', msg(e)),
  })
  const confirm = () => a.confirm.mutate(code.trim(), {
    onSuccess: (r) => { setCodes(r.recoveryCodes); setInfo(null); setCode(''); setMode('codes'); show('ok', 'Two-factor sign-in is on') },
    onError: (e) => show('error', 'Not turned on', msg(e)),
  })
  const disable = () => a.disable.mutate(code.trim(), {
    onSuccess: () => { reset(); show('ok', 'Two-factor sign-in is off') },
    onError: (e) => show('error', 'Not turned off', msg(e)),
  })
  const regenerate = () => a.regenerate.mutate(code.trim(), {
    onSuccess: (r) => { setCodes(r.recoveryCodes); setCode(''); setMode('codes'); show('ok', 'New recovery codes made', 'The old ones no longer work.') },
    onError: (e) => show('error', 'No new codes made', msg(e)),
  })

  const on = !!status?.enabled
  const summary = !status ? 'Loading…'
    : on ? `On since ${dayIst(status.enabledAt)} · ${status.recoveryCodesLeft} recovery ${status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left`
      : 'Off. Protect your account with a 6-digit code from an authenticator app on your phone.'
  const codeOk = /^\d{6}$/.test(code.trim())
  const codeOrRecoveryOk = codeOk || code.replace(/[^a-z0-9]/gi, '').length === 10

  return (
    <SettingsSection id="twofa" icon="shield" title="Two-factor authentication" summary={summary}>
      {!status ? <div role="status" aria-label="Loading two-factor status"><SkeletonBlock className="h-16 w-full rounded-xl" /></div> : (
        <>
          {status.requiredForYou && !on && mode === 'idle' && (
            <SettingsNote tone="amber"><strong>Your workspace requires two-factor sign-in for you.</strong> Set it up now. If you don’t, you’ll be asked to set it up the next time you sign in on the web, before you can continue.</SettingsNote>
          )}

          {mode === 'idle' && !on && (
            <>
              <SettingsNote>When it’s on, signing in with your password also asks for a 6-digit code from an app on your phone, so a stolen password alone can’t get into your account. The mobile attendance app can’t ask for the code yet: in the app, sign in with your mobile number (text-message code) instead.</SettingsNote>
              <div><HrButton onClick={start} disabled={a.setup.isPending}>{a.setup.isPending ? 'Preparing…' : 'Set up two-factor'}</HrButton></div>
            </>
          )}

          {mode === 'setup' && info && (
            <>
              <SetupKey info={info} />
              <SettingsGrid min={220}>
                <SettingsInput label="6-digit code" value={code} onChange={(v) => setCode(v.replace(/[^\d\s]/g, ''))} inputMode="numeric" maxLength={7} placeholder="123456" mono
                  hint="The code changes every 30 seconds." />
              </SettingsGrid>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <HrButton onClick={confirm} disabled={!codeOk || a.confirm.isPending}>{a.confirm.isPending ? 'Checking…' : 'Turn on'}</HrButton>
                <HrButton variant="ghost" onClick={reset} disabled={a.confirm.isPending}>Cancel</HrButton>
              </div>
            </>
          )}

          {mode === 'codes' && <RecoveryCodes codes={codes} label="Two-factor sign-in" onDone={() => { setCodes([]); setMode('idle') }} show={show} />}

          {mode === 'idle' && on && (
            <>
              <SettingsGrid min={200}>
                <SettingsValue label="Status" value="On" />
                <SettingsValue label="Turned on" value={whenIst(status.enabledAt)} />
                <SettingsValue label="Recovery codes left" value={String(status.recoveryCodesLeft)} />
              </SettingsGrid>
              {status.recoveryCodesLeft <= 3 && <SettingsNote tone="amber">You’re running out of recovery codes. Make new ones so you can still sign in if you lose your phone.</SettingsNote>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <HrButton variant="ghost" onClick={() => { setCode(''); setMode('regenerate') }}>Make new recovery codes</HrButton>
                <HrButton variant="ghost" onClick={() => { setCode(''); setMode('disable') }} disabled={status.requiredForYou}
                  title={status.requiredForYou ? 'Your workspace requires two-factor for you' : undefined}>Turn off</HrButton>
              </div>
              {status.requiredForYou && <SettingsNote>Your workspace requires two-factor for you, so it can’t be turned off. Changing phones? Ask an admin to reset it, then set it up again on the new phone.</SettingsNote>}
            </>
          )}

          {(mode === 'disable' || mode === 'regenerate') && (
            <>
              <SettingsNote tone={mode === 'disable' ? 'amber' : undefined}>{mode === 'disable'
                ? 'Turning two-factor off means your password alone signs you in again. Enter a current code from your app (or a recovery code) to confirm.'
                : 'Your current recovery codes stop working and ten new ones are made. Enter a current code from your app (or a recovery code) to confirm.'}</SettingsNote>
              <SettingsGrid min={220}>
                <SettingsInput label="Code from your app, or a recovery code" value={code} onChange={setCode} maxLength={11} placeholder="123456" mono />
              </SettingsGrid>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {mode === 'disable'
                  ? <HrButton variant="danger" onClick={disable} disabled={!codeOrRecoveryOk || a.disable.isPending}>{a.disable.isPending ? 'Turning off…' : 'Turn off two-factor'}</HrButton>
                  : <HrButton onClick={regenerate} disabled={!codeOrRecoveryOk || a.regenerate.isPending}>{a.regenerate.isPending ? 'Making codes…' : 'Make new codes'}</HrButton>}
                <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>
              </div>
            </>
          )}
        </>
      )}
    </SettingsSection>
  )
}

const SessionsSection: React.FC<{ show: Show }> = ({ show }) => {
  const sessions = useSessions()
  const a = useSessionActions()
  const confirm = useConfirmDialog()
  const list = sessions.data ?? []
  const others = list.filter((s) => !s.current).length
  const summary = sessions.isLoading ? 'Loading your sessions…' : sessions.isError ? 'Couldn’t load your sessions'
    : `${list.length} signed-in ${list.length === 1 ? 'session' : 'sessions'} on the web and the mobile app`

  const signOutOne = async (id: string, device: string) => {
    if (!(await confirm({ title: `Sign out ${device}?`, body: 'That device is signed out within about 30 seconds and has to sign in again.', confirmLabel: 'Sign out', tone: 'danger' }))) return
    a.revoke.mutate(id, { onSuccess: () => show('ok', 'Session signed out'), onError: (e) => show('error', 'Couldn’t sign it out', msg(e)) })
  }
  const signOutOthers = async () => {
    if (!(await confirm({ title: 'Sign out every other session?', body: 'Every other browser and phone signed in to your account is signed out within about 30 seconds. This one stays signed in.', confirmLabel: 'Sign out others', tone: 'danger' }))) return
    a.revokeOthers.mutate(undefined, {
      onSuccess: (r) => show('ok', r.signedOut ? `Signed out ${r.signedOut} other ${r.signedOut === 1 ? 'session' : 'sessions'}` : 'No other sessions to sign out'),
      onError: (e) => show('error', 'Couldn’t sign them out', msg(e)),
    })
  }

  return (
    <SettingsSection id="sessions" icon="smartphone" title="Active sessions" summary={summary}>
      {sessions.isLoading ? <div role="status" aria-label="Loading sessions"><SkeletonBlock className="h-24 w-full rounded-xl" /></div>
        : sessions.isError ? <SettingsNote tone="amber">We couldn’t load your sessions just now. <button type="button" onClick={() => sessions.refetch()} style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Try again</button></SettingsNote>
          : (
            <>
              <div style={{ display: 'grid', gap: 10 }}>
                {list.map((s) => (
                  <div key={s.id} style={ROW}>
                    <span aria-hidden="true" style={{ flex: '0 0 auto', color: '#64748b', display: 'inline-flex' }}>{s.kind === 'app' ? <Smartphone size={18} /> : <Monitor size={18} />}</span>
                    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 4 }}>
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 14 }}>{s.device}</strong>{s.current && <HrStatusPill tone="ok">This device</HrStatusPill>}</span>
                      <span style={{ fontSize: 12.5, color: '#64748b' }}>
                        {s.ipAddress ? <>IP <span className="tabular-nums">{s.ipAddress}</span> · </> : null}
                        signed in {dayIst(s.signedInAt)} · last active {ago(s.lastActiveAt)}
                      </span>
                    </div>
                    {!s.current && <HrButton variant="ghost" size="sm" onClick={() => signOutOne(s.id, s.device)} disabled={a.revoke.isPending}>Sign out</HrButton>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <HrButton variant="ghost" onClick={signOutOthers} disabled={others === 0 || a.revokeOthers.isPending}>{a.revokeOthers.isPending ? 'Signing out…' : 'Sign out all other sessions'}</HrButton>
              </div>
              <SettingsNote>A session is one browser or phone where you’re signed in. It ends after 7 days without use. If you don’t recognise one, sign it out and change your password.</SettingsNote>
            </>
          )}
    </SettingsSection>
  )
}

const WorkspaceRuleSection: React.FC<{ draft: MfaPolicy | null; setDraft: (p: MfaPolicy) => void; show: Show }> = ({ draft, setDraft, show }) => {
  const summary = useWorkspaceSecurity(true)
  const members = useSecurityMembers(true)
  const a = useWorkspaceSecurityActions()
  const confirm = useConfirmDialog()
  const me = useAuthStore((s) => s.user)
  const current = summary.data?.mfaPolicy ?? 'OFF'
  const value = draft ?? current
  const list = members.data ?? []
  const on = list.filter((m) => m.mfaEnabled)
  const missing = list.filter((m) => m.requiredByRule && !m.mfaEnabled)

  const resetFor = async (userId: string, name: string, email: string) => {
    if (!(await confirm({
      title: `Turn off two-factor for ${name}?`,
      body: `Only do this if ${name} lost their phone and their recovery codes. They are signed out everywhere, can sign in with just their password, and get an email about it. ${current === 'OFF' ? '' : 'The workspace rule will ask them to set it up again at their next sign-in.'}`,
      confirmLabel: 'Turn off two-factor', tone: 'danger',
    }))) return
    a.resetMember.mutate(userId, {
      onSuccess: () => show('ok', `Two-factor turned off for ${email}`, 'They were signed out everywhere and emailed.'),
      onError: (e) => show('error', 'Not turned off', msg(e)),
    })
  }

  return (
    <SettingsSection id="rule" icon="users" title="Two-factor for the workspace"
      summary={summary.data ? `${POLICY_LABEL[current]} · ${summary.data.withTwoFactor} of ${summary.data.people} people have it on` : 'Who must use two-factor sign-in'}>
      {summary.isLoading ? <div role="status" aria-label="Loading the workspace rule"><SkeletonBlock className="h-16 w-full rounded-xl" /></div>
        : summary.isError ? <SettingsNote tone="amber">We couldn’t load the workspace rule just now.</SettingsNote>
          : (
            <>
              <div style={{ display: 'grid', gap: 6, maxWidth: 360 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Who must use two-factor</span>
                <HrSelect value={value} onChange={(v: string) => setDraft(v as MfaPolicy)} options={(Object.keys(POLICY_LABEL) as MfaPolicy[]).map((p) => ({ value: p, label: POLICY_LABEL[p] }))} />
              </div>
              <SettingsNote>{POLICY_DETAIL[value]} Signing in with a mobile-number text code, or through the account portal, isn’t affected.</SettingsNote>
              {value !== 'OFF' && (
                <SettingsNote tone="amber"><strong>This changes how people sign in.</strong> Everyone the rule covers who hasn’t set up two-factor is walked through it the next time they sign in on the web, before they can continue. The mobile attendance app can’t ask for codes yet, so in the app they must sign in with their mobile number (text-message code); email-and-password sign-in in the app stops working for them.{value !== current && summary.data ? ` Right now, ${list.filter((m) => !m.mfaEnabled && (value === 'EVERYONE' || m.roles.some((r) => ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'].includes(r)))).length} of them haven’t set it up.` : ''}</SettingsNote>
              )}
              {summary.data && value === current && current !== 'OFF' && (
                <SettingsValue label="Covered by the rule but not set up yet" value={String(summary.data.requiredButNotSetUp)} />
              )}

              <div style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>People with two-factor on ({on.length})</span>
                {members.isLoading ? <SkeletonBlock className="h-16 w-full rounded-xl" />
                  : on.length === 0 ? <SettingsNote>Nobody has turned it on yet.</SettingsNote>
                    : on.slice(0, 100).map((m) => (
                      <div key={m.userId} style={ROW}>
                        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 2 }}>
                          <strong style={{ fontSize: 14 }}>{m.name}</strong>
                          <span style={{ fontSize: 12.5, color: '#64748b' }}>{m.email} · on since {dayIst(m.mfaEnabledAt)}</span>
                        </div>
                        {m.userId !== me?.id && <HrButton variant="ghost" size="sm" onClick={() => resetFor(m.userId, m.name, m.email)} disabled={a.resetMember.isPending}>Turn off</HrButton>}
                      </div>
                    ))}
                {missing.length > 0 && (
                  <SettingsNote>Covered by the rule, not set up yet: {missing.slice(0, 20).map((m) => m.name).join(', ')}{missing.length > 20 ? ` and ${missing.length - 20} more` : ''}. They’ll be asked at their next web sign-in.</SettingsNote>
                )}
              </div>
            </>
          )}
    </SettingsSection>
  )
}

export const SecuritySettings: React.FC<{ crumb: string; title: string; subtitle: string }> = ({ crumb, title, subtitle }) => {
  const canManage = usePermission('workspace.security.manage')
  const status = useMfaStatus()
  const ws = useWorkspaceSecurity(canManage)
  const setPolicy = useWorkspaceSecurityActions().setPolicy
  const [draft, setDraft] = useState<MfaPolicy | null>(null)
  const { toast, show, dismiss } = useSettingsToast()
  const current = ws.data?.mfaPolicy
  const dirty = canManage && draft != null && draft !== current

  const save = () => {
    if (!draft) return
    setPolicy.mutate(draft, {
      onSuccess: (r) => { setDraft(null); show('ok', 'Workspace rule saved', r.mfaPolicy === 'OFF' ? 'Two-factor is optional.' : `${r.requiredButNotSetUp} ${r.requiredButNotSetUp === 1 ? 'person' : 'people'} will be asked to set it up at their next web sign-in.`) },
      onError: (e) => show('error', 'Couldn’t save the rule', msg(e)),
    })
  }

  const nav: SettingsNavItem[] = [
    { key: 'password', label: 'Password', state: 'on' },
    { key: 'twofa', label: 'Two-factor', state: status.data ? (status.data.enabled ? 'on' : 'off') : 'none' },
    { key: 'sessions', label: 'Active sessions', state: 'none' },
    ...(canManage ? [{ key: 'rule', label: 'Workspace rule', state: (current && current !== 'OFF' ? 'on' : 'off') as SettingsNavItem['state'] }] : []),
  ]

  return (
    <SettingsPage crumb={crumb} title={title} subtitle={subtitle} nav={nav} access="edit"
      status={status.isLoading ? 'loading' : status.isError ? 'error' : 'live'} onRetry={() => { void status.refetch() }} entity="security settings"
      dirty={dirty} changeCount={dirty ? 1 : 0} errorCount={0} saving={setPolicy.isPending} onSave={save} onDiscard={() => setDraft(null)}
      toast={toast} onDismissToast={dismiss}>
      <PasswordSection />
      <TwoFactorSection status={status.data} show={show} />
      <SessionsSection show={show} />
      {canManage && <WorkspaceRuleSection draft={draft} setDraft={setDraft} show={show} />}
    </SettingsPage>
  )
}
