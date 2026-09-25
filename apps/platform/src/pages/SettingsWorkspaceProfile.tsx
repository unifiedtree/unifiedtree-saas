// Workspace Settings -> Profile (/settings/profile): the signed-in account
// (display name, phone; PUT /v1/users/me) and the workspace's own profile
// (name, contact, address, GSTIN, PAN; PUT /v1/workspace/profile, needs
// workspace.profile.update). One unsaved-changes bar saves both.
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { useCurrentUser, useUpdateCurrentUser } from '@/shared/hooks/useCurrentUser'
import { SettingsPage, SettingsSection, SettingsGrid, SettingsInput, SettingsValue, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import { fieldErrors, useUpdateWorkspaceProfile, useWorkspaceProfile, type WorkspaceProfile, type WorkspaceProfileInput } from './workspaceSettingsApi'

type OrgDraft = { [K in keyof WorkspaceProfileInput]: string }
type AccountDraft = { displayName: string; phone: string }

const ORG_KEYS: (keyof OrgDraft)[] = ['displayName', 'contactEmail', 'contactPhone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'gstin', 'pan']
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const orgFrom = (p: WorkspaceProfile): OrgDraft => Object.fromEntries(ORG_KEYS.map((k) => [k, (p[k] as string | null) ?? ''])) as OrgDraft
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
const taxId = (s: string) => s.replace(/\s/g, '').toUpperCase()

/** Same rules as the server's WorkspaceProfileRules, so mistakes show before saving. */
export function gstinChecksumOk(g: string): boolean {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = B36.indexOf(g[i])
    if (v < 0) return false
    const p = v * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return B36[(36 - (sum % 36)) % 36] === g[14]
}

function orgErrors(d: OrgDraft): Partial<Record<keyof OrgDraft, string>> {
  const e: Partial<Record<keyof OrgDraft, string>> = {}
  const name = norm(d.displayName)
  if (name.length < 2) e.displayName = 'Enter the workspace name (at least 2 characters).'
  else if (name.length > 150) e.displayName = 'Keep the name to 150 characters.'
  if (d.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.contactEmail.trim())) e.contactEmail = 'Enter an email address like accounts@company.com.'
  if (d.contactPhone.trim() && !/^\+?[\d\s()-]{7,20}$/.test(d.contactPhone.trim())) e.contactPhone = 'Enter a phone number (digits, spaces, + and - only).'
  if (d.postalCode.trim() && !/^[1-9][0-9]{5}$/.test(d.postalCode.trim())) e.postalCode = 'Enter a 6-digit PIN code.'
  const pan = taxId(d.pan), gstin = taxId(d.gstin)
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) e.pan = 'Enter a PAN like ABCDE1234F.'
  if (gstin) {
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) e.gstin = 'Enter a 15-character GSTIN like 27ABCDE1234F1Z5.'
    else if (!gstinChecksumOk(gstin)) e.gstin = 'This GSTIN’s last character doesn’t match. Check it for typos.'
    else if (pan && !e.pan && gstin.slice(2, 12) !== pan) e.gstin = `Characters 3 to 12 of the GSTIN must be the PAN (${pan}).`
  }
  return e
}

export const WorkspaceProfileSettings: React.FC<{ crumb: string; title: string; subtitle: string }> = ({ crumb, title, subtitle }) => {
  const authUser = useAuthStore((s) => s.user)
  const me = useCurrentUser()
  const updateMe = useUpdateCurrentUser()
  const profile = useWorkspaceProfile()
  const updateOrg = useUpdateWorkspaceProfile()
  const { toast, show, dismiss } = useSettingsToast()

  const [acc, setAcc] = useState<AccountDraft | null>(null)
  const [org, setOrg] = useState<OrgDraft | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const accBase = useMemo<AccountDraft | null>(() => me.data ? {
    displayName: me.data.displayName ?? [me.data.firstName, me.data.lastName].filter(Boolean).join(' '),
    phone: me.data.phone ?? '',
  } : null, [me.data])
  const orgBase = useMemo(() => profile.data ? orgFrom(profile.data) : null, [profile.data])
  useEffect(() => { if (accBase && !acc) setAcc(accBase) }, [accBase]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (orgBase && !org) setOrg(orgBase) }, [orgBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = !!profile.data?.canEdit
  const accChanged = !!acc && !!accBase && (norm(acc.displayName) !== norm(accBase.displayName) || acc.phone.trim() !== accBase.phone.trim())
  const orgChangedKeys = org && orgBase ? ORG_KEYS.filter((k) => (k === 'gstin' || k === 'pan' ? taxId(org[k]) !== taxId(orgBase[k]) : norm(org[k]) !== norm(orgBase[k]))) : []
  const orgChanged = canEdit && orgChangedKeys.length > 0

  const accErr = {
    displayName: acc && !norm(acc.displayName) ? 'Enter the name to show' : undefined,
    phone: acc && acc.phone.trim() && !/^\+?[\d\s()-]{7,20}$/.test(acc.phone.trim()) ? 'Enter a phone number (digits, spaces, + and - only)' : undefined,
  }
  const oErr = org && canEdit ? orgErrors(org) : {}
  const errOf = (k: keyof OrgDraft) => oErr[k] ?? serverErrors[k]
  const errorCount = Object.values(accErr).filter(Boolean).length + ORG_KEYS.filter((k) => errOf(k)).length
  const dirty = accChanged || orgChanged
  const changeCount = (accChanged ? 1 : 0) + orgChangedKeys.length * (canEdit ? 1 : 0)
  const saving = updateMe.isPending || updateOrg.isPending

  const save = async () => {
    if (errorCount || !dirty) return
    setServerErrors({})
    try {
      if (accChanged && acc && accBase) {
        const patch: { displayName?: string; phone?: string } = {}
        if (norm(acc.displayName) !== norm(accBase.displayName)) patch.displayName = norm(acc.displayName)
        if (acc.phone.trim() !== accBase.phone.trim()) patch.phone = acc.phone.trim()
        const r = await updateMe.mutateAsync(patch)
        setAcc({ displayName: r.displayName ?? norm(acc.displayName), phone: r.phone ?? '' })
      }
      if (orgChanged && org) {
        const body = Object.fromEntries(ORG_KEYS.map((k) => [k, k === 'gstin' || k === 'pan' ? taxId(org[k]) || null : norm(org[k]) || null])) as unknown as WorkspaceProfileInput
        const saved = await updateOrg.mutateAsync(body)
        setOrg(orgFrom(saved))
        // The workspace name shows in the shell and the switcher: update the cached copies.
        useAuthStore.setState((s) => (s.tenant ? { tenant: { ...s.tenant, name: saved.displayName } } : {}))
        useSdkStore.setState((s) => (s.tenant ? { tenant: { ...s.tenant, displayName: saved.displayName } } : {}))
      }
      show('ok', 'Profile saved')
    } catch (e) {
      const f = fieldErrors(e)
      setServerErrors(f)
      show('error', 'Couldn’t save', (e as Error).message)
    }
  }
  const discard = () => { if (accBase) setAcc(accBase); if (orgBase) setOrg(orgBase); setServerErrors({}) }
  const setO = (k: keyof OrgDraft) => (v: string) => { setOrg((d) => (d ? { ...d, [k]: v } : d)); setServerErrors((s) => { const n = { ...s }; delete n[k]; return n }) }

  const nav: SettingsNavItem[] = [
    { key: 'account', label: 'Your account', state: 'none', errors: Object.values(accErr).filter(Boolean).length || undefined },
    { key: 'org', label: 'Organisation', state: 'none', errors: ORG_KEYS.filter((k) => errOf(k)).length || undefined },
  ]
  const p = profile.data
  const loading = (me.isLoading && !me.data) || (profile.isLoading && !profile.data)
  const failed = me.isError || profile.isError

  return (
    <SettingsPage crumb={crumb} title={title} subtitle={subtitle} nav={nav} access="edit"
      status={loading ? 'loading' : failed ? 'error' : 'live'} onRetry={() => { void me.refetch(); void profile.refetch() }} entity="the profile"
      dirty={dirty} changeCount={changeCount} errorCount={dirty ? errorCount : 0}
      onGoToError={() => document.getElementById(Object.values(accErr).some(Boolean) ? 'st-account' : 'st-org')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      saving={saving} onSave={() => { void save() }} onDiscard={discard} toast={toast} onDismissToast={dismiss}>
      <SettingsSection id="account" icon="userCheck" title="Your account" summary={[acc ? norm(acc.displayName) : '', me.data?.email].filter(Boolean).join(' · ')}>
        <SettingsGrid min={220}>
          <SettingsInput label="Display name" value={acc?.displayName ?? ''} onChange={(v) => setAcc((d) => d && ({ ...d, displayName: v }))} error={accErr.displayName} maxLength={150} placeholder="How your name appears" />
          <SettingsInput label="Phone" value={acc?.phone ?? ''} onChange={(v) => setAcc((d) => d && ({ ...d, phone: v }))} error={accErr.phone} maxLength={20} placeholder="+91 98xxxxxxxx" hint="Used for account recovery and text-message sign-in in the app." />
          <SettingsValue label="Sign-in email" value={me.data?.email || authUser?.email || '—'} />
          <SettingsValue label="Role" value={authUser?.role || '—'} />
        </SettingsGrid>
        <SettingsNote>Your first and last name come from your employee record, which HR keeps. Your photo, documents and notification choices are on <Link to="/profile" style={{ color: '#047857', fontWeight: 600 }}>your profile</Link>.</SettingsNote>
      </SettingsSection>

      <SettingsSection id="org" icon="building" title="Organisation" summary={[p?.displayName, p?.subdomain].filter(Boolean).join(' · ')}>
        <SettingsGrid min={220}>
          <SettingsInput label="Workspace name" value={org?.displayName ?? ''} onChange={setO('displayName')} readOnly={!canEdit} error={canEdit ? errOf('displayName') : undefined} maxLength={150} />
          <SettingsInput label="Contact email" value={org?.contactEmail ?? ''} onChange={setO('contactEmail')} readOnly={!canEdit} error={canEdit ? errOf('contactEmail') : undefined} maxLength={255} placeholder="accounts@company.com" />
          <SettingsInput label="Contact phone" value={org?.contactPhone ?? ''} onChange={setO('contactPhone')} readOnly={!canEdit} error={canEdit ? errOf('contactPhone') : undefined} maxLength={20} placeholder="+91 20 1234 5678" />
          <SettingsValue label="Web address" value={p?.subdomain || '—'} />
          <SettingsValue label="Plan" value={p?.planType || '—'} />
        </SettingsGrid>
        <SettingsGrid min={220}>
          <SettingsInput label="Address line 1" value={org?.addressLine1 ?? ''} onChange={setO('addressLine1')} readOnly={!canEdit} error={canEdit ? errOf('addressLine1') : undefined} maxLength={255} />
          <SettingsInput label="Address line 2" value={org?.addressLine2 ?? ''} onChange={setO('addressLine2')} readOnly={!canEdit} error={canEdit ? errOf('addressLine2') : undefined} maxLength={255} />
          <SettingsInput label="City" value={org?.city ?? ''} onChange={setO('city')} readOnly={!canEdit} error={canEdit ? errOf('city') : undefined} maxLength={100} />
          <SettingsInput label="State" value={org?.state ?? ''} onChange={setO('state')} readOnly={!canEdit} error={canEdit ? errOf('state') : undefined} maxLength={100} />
          <SettingsInput label="PIN code" value={org?.postalCode ?? ''} onChange={setO('postalCode')} readOnly={!canEdit} error={canEdit ? errOf('postalCode') : undefined} inputMode="numeric" maxLength={6} />
        </SettingsGrid>
        <SettingsGrid min={220}>
          <SettingsInput label="GSTIN" value={org?.gstin ?? ''} onChange={setO('gstin')} readOnly={!canEdit} error={canEdit ? errOf('gstin') : undefined} mono maxLength={15} placeholder="27ABCDE1234F1Z5" />
          <SettingsInput label="PAN" value={org?.pan ?? ''} onChange={setO('pan')} readOnly={!canEdit} error={canEdit ? errOf('pan') : undefined} mono maxLength={10} placeholder="ABCDE1234F" />
        </SettingsGrid>
        <SettingsNote>{canEdit
          ? 'The workspace name shows in the app, in emails the workspace sends and in authenticator apps. The legal details each company prints on payslips and letters are set per company on Companies & Branches.'
          : 'Only people who may edit the workspace profile (owners and admins) can change these details.'}</SettingsNote>
      </SettingsSection>
    </SettingsPage>
  )
}
