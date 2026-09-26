// Real-data container for the redesigned Companies & Branches page
// (design/dc/CompaniesPage). Saves go through the existing workforce endpoints.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usePermission, P } from '@unifiedtree/sdk'
import { CompaniesPage } from '@/design/dc/CompaniesPage'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import {
  useCompanies, useBranches, useCreateCompany, useUpdateCompany, useArchiveCompany,
  useCreateBranch, useUpdateBranch, useSaveBranchGeofence, useArchiveBranch,
  useCompaniesWithArchived, useRestoreCompany, type Company,
} from '../api/useOrg'
import { useHrConfig, useUpdateHrConfig } from '../api/useSettings'

const errText = (e: unknown) => (e as Error)?.message || 'Please try again.'

/** A company as the page draws it. */
const toCompanyView = (c: Company) => ({
  id: c.id, name: c.name, legal: c.legalName || '', industry: c.industry || '', currency: c.currency || 'INR', country: c.country || 'India',
  desc: '', cin: c.registrationNumber || '', pan: c.panNumber || '', gstin: c.gstin || '', employees: c.employeeCount ?? 0,
  status: c.active === false ? 'INACTIVE' : 'ACTIVE',
})

export function CompaniesPageContainer() {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const canEdit = usePermission(P.ORG_COMPANY_WRITE)
  const canReadCompanies = usePermission(P.ORG_COMPANY_READ)
  const canGeofence = usePermission('org.geofence.write' as any)

  const companiesQ = useCompanies()
  // Archived companies too, for the same "Inactive" filter (only the archived ones are used from it).
  const withArchivedQ = useCompaniesWithArchived(canReadCompanies)
  // Archived branches too, for the "Inactive" filter (they come back with active: false).
  const branchesQ = useBranches(undefined, { includeArchived: true })
  const [picked, setPicked] = useState<string | undefined>()
  const companiesRaw = useMemo(() => companiesQ.data ?? [], [companiesQ.data])
  const selectedId = picked && companiesRaw.some((c) => c.id === picked) ? picked : companiesRaw[0]?.id
  const hrConfig = useHrConfig(selectedId)

  const createCompany = useCreateCompany()
  const updateCompany = useUpdateCompany()
  const archiveCompany = useArchiveCompany()
  const restoreCompany = useRestoreCompany()
  const createBranch = useCreateBranch()
  const updateBranch = useUpdateBranch()
  const saveGeofence = useSaveBranchGeofence()
  const archiveBranch = useArchiveBranch()
  const updateHrConfig = useUpdateHrConfig()

  const companies = useMemo(() => companiesRaw.map(toCompanyView), [companiesRaw])
  // An older server ignores includeArchived and sends active companies only: then none show as archived.
  const archivedCompanies = useMemo(() => (withArchivedQ.data ?? []).filter((c) => c.active === false).map(toCompanyView), [withArchivedQ.data])

  const allBranches = useMemo(() => (branchesQ.data ?? []).map((b) => ({
    id: b.id, companyId: b.companyId, name: b.name, code: b.code || '', city: b.city || '', state: b.state || '', country: b.country || 'India',
    employees: b.employeeCount ?? 0, hq: !!b.headquarters, status: b.active === false ? 'INACTIVE' : 'ACTIVE',
    geo: { on: !!b.geoFenceEnforced, lat: b.latitude ?? '', lng: b.longitude ?? '', radius: b.geoFenceRadiusMeters || 100 },
  })), [branchesQ.data])
  // Active branches drive the cards, counts and the headquarters; archived ones show under "Inactive".
  const branches = useMemo(() => allBranches.filter((b) => b.status === 'ACTIVE'), [allBranches])
  const archivedBranches = useMemo(() => allBranches.filter((b) => b.status !== 'ACTIVE'), [allBranches])

  const cfg = hrConfig.data
  const format = cfg ? { prefix: cfg.employeeCodePrefix || 'EMP', next: String(cfg.employeeCodeNextNumber ?? 1).padStart(cfg.employeeCodePadding ?? 4, '0') } : null

  const state = companiesQ.isLoading ? 'loading' : companiesQ.isError ? 'error' : companies.length === 0 ? 'empty' : 'live'

  return (
    <DesignFrame>
      <CompaniesPage
        state={state}
        mobile={mobile}
        canEdit={canEdit}
        companies={companies}
        branches={branches}
        archivedBranches={archivedBranches}
        archivedCompanies={archivedCompanies}
        archivedCompaniesError={withArchivedQ.isError}
        branchesLoading={branchesQ.isLoading}
        branchesError={branchesQ.isError}
        companyId={selectedId}
        format={format}
        onPickCompany={setPicked}
        onNavigate={(path: string) => navigate(path)}
        onRetry={() => { companiesQ.refetch(); branchesQ.refetch() }}
        onRetryArchived={() => { withArchivedQ.refetch() }}
        onSaveCompany={async (c: any) => {
          // Send every field as typed ("" clears it): the update endpoint skips nulls, so undefined would keep the old value.
          const body = { name: c.name, legalName: c.legal ?? '', industry: c.industry ?? '', currency: c.currency, country: c.country, registrationNumber: c.cin ?? '', panNumber: c.pan ?? '', gstin: c.gstin ?? '' }
          try {
            if (c.id) { await updateCompany.mutateAsync({ id: c.id, ...body }); toast.success('Company updated') } else {
              const created = await createCompany.mutateAsync(body)
              if (created?.id) setPicked(created.id)
              toast.success(`${c.name} created`)
            }
            return true
          } catch (e) { toast.error('Could not save the company', { description: errText(e) }); return false }
        }}
        onSaveFormat={async (co: any, f: { prefix: string; next: string }) => {
          if (!co?.id) return false
          try {
            await updateHrConfig.mutateAsync({ companyId: co.id, body: { employeeCodePrefix: f.prefix, employeeCodeNextNumber: Number(f.next), employeeCodePadding: f.next.length } })
            toast.success(`Employee ID format saved · next is ${f.prefix}-${f.next}`)
            return true
          } catch (e) { toast.error('Could not save the employee ID format', { description: errText(e) }); return false }
        }}
        onSaveBranch={async (b: any) => {
          // An archived branch can't be the headquarters (the server would keep it off).
          if (b.id && b.status === 'INACTIVE' && b.hq) {
            toast.error('Restore this branch first', { description: 'An archived branch can’t be the headquarters. Restore it from the Inactive filter, then mark it.' })
            return false
          }
          try {
            const fields = { name: b.name, code: b.code || undefined, city: b.city, state: b.state, country: b.country, isHeadquarters: !!b.hq }
            let id: string = b.id
            // One headquarters per company: the server switches the previous one
            // off in this same save ("Replaces X as the headquarters").
            if (id) await updateBranch.mutateAsync({ id, ...fields })
            else id = (await createBranch.mutateAsync({ companyId: b.companyId, ...fields })).id
            const g = b.geo || {}
            const hasPin = g.lat !== '' && g.lng !== '' && g.lat != null && g.lng != null
            if (hasPin) {
              if (canGeofence) await saveGeofence.mutateAsync({ id, latitude: Number(g.lat), longitude: Number(g.lng), radiusMeters: Number(g.radius) || 100, enforced: !!g.on })
              else toast.message('Branch saved without its attendance area', { description: "Your role can't change geofences." })
            }
            toast.success(b.id ? 'Branch updated' : `${b.name} created`)
            return true
          } catch (e) { toast.error('Could not save the branch', { description: errText(e) }); return false }
        }}
        onRestoreBranch={async (b: { id: string; name: string }) => {
          try {
            await updateBranch.mutateAsync({ id: b.id, isActive: true })
            toast.success(`${b.name} restored`, { description: 'It shows in lists and pickers again.' })
            return true
          } catch (e) { toast.error('Could not restore the branch', { description: errText(e) }); return false }
        }}
        onRestoreCompany={async (c: { id: string; name: string }) => {
          try {
            await restoreCompany.mutateAsync(c.id)
            toast.success(`${c.name} restored`, { description: 'It shows in lists and pickers again.' })
            return true
          } catch (e) { toast.error('Could not restore the company', { description: errText(e) }); return false }
        }}
        onArchive={async (kind: 'branch' | 'company', id: string) => {
          try {
            if (kind === 'branch') { await archiveBranch.mutateAsync(id); toast.success('Branch archived') } else {
              await archiveCompany.mutateAsync(id)
              if (id === selectedId) setPicked(undefined)
              toast.success('Company archived', { description: 'To bring it back, choose Inactive in the status filter.' })
            }
            return true
          } catch (e) { toast.error(kind === 'branch' ? 'Could not archive the branch' : 'Could not archive the company', { description: errText(e) }); return false }
        }}
      />
    </DesignFrame>
  )
}
