import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload, Users, UserCheck, UserX, Clock, ChevronLeft, ChevronRight, Building2 } from 'lucide-react'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { Can, usePermission, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrStatCard, HrStatusPill, HrPageHeader, HrButton, TableCard, HrAvatar, type PillTone } from '@/shared/components/hr'
import { useEmployeeDirectory, type EmploymentStatus } from './api/useWorkforce'
import { useCompanies, useDepartments, useBranches } from './api/useOrg'
import { EmployeeForm } from './employees/EmployeeForm'
import { useDebounce } from '@/shared/hooks/useDebounce'

// Keys MUST match backend WorkforceEmployee.EmploymentStatus.
const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE: { label: 'Active', color: 'text-success', bg: 'bg-success/10 border-success/20' },
  PROBATION: { label: 'Probation', color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
  NOTICE_PERIOD: { label: 'Notice', color: 'text-orange-600', bg: 'bg-orange-100 border-orange-200' },
  SUSPENDED: { label: 'Suspended', color: 'text-amber-700', bg: 'bg-amber-100 border-amber-200' },
  EXITED: { label: 'Exited', color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
  TERMINATED: { label: 'Terminated', color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
}

const STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: 'ok', PROBATION: 'warn', NOTICE_PERIOD: 'late', SUSPENDED: 'warn', EXITED: 'red', TERMINATED: 'red',
}

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'NOTICE_PERIOD', label: 'On Notice' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXITED', label: 'Exited' },
  { value: 'TERMINATED', label: 'Terminated' },
]

export const Employees: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const canWrite = usePermission(P.HRMS_EMPLOYEE_WRITE)

  const { data: companies = [], isLoading: companiesLoading } = useCompanies()
  const activeCompany = companies[0]
  const canCreateCompany = usePermission(P.ORG_COMPANY_WRITE)
  // P0-2: a fresh tenant has no companies. Adding an employee needs one, so guide
  // the user to create a company first instead of letting the form fail cryptically.
  const noCompany = !companiesLoading && companies.length === 0

  const { data: departments = [] } = useDepartments(activeCompany?.id ?? '')
  const { data: branches = [] } = useBranches(activeCompany?.id)

  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [showForm, setShowForm] = useState(false)

  const debouncedSearch = useDebounce(search, 350)

  const { data, isLoading, isFetching, error: dirError, refetch } = useEmployeeDirectory({
    companyId: activeCompany?.id,
    departmentId: departmentId || undefined,
    branchId: branchId || undefined,
    status: (status as EmploymentStatus) || undefined,
    search: debouncedSearch || undefined,
    page,
    pageSize: 25,
  })

  const employees = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  // Stat-card counts: server-side totals scoped to the company and independent of
  // the table's department/branch/status/search filters — so the cards are a
  // stable workforce breakdown, not a count of just the current page (max 25).
  const cid = activeCompany?.id
  const { data: allCount }    = useEmployeeDirectory({ companyId: cid, pageSize: 1 })
  const { data: activeCount } = useEmployeeDirectory({ companyId: cid, status: 'ACTIVE', pageSize: 1 })
  const { data: noticeCount } = useEmployeeDirectory({ companyId: cid, status: 'NOTICE_PERIOD', pageSize: 1 })
  const { data: exitedCount } = useEmployeeDirectory({ companyId: cid, status: 'EXITED', pageSize: 1 })
  const { data: termCount }   = useEmployeeDirectory({ companyId: cid, status: 'TERMINATED', pageSize: 1 })

  const statusCounts = {
    total: allCount?.totalElements ?? 0,
    active: activeCount?.totalElements ?? 0,
    onLeave: noticeCount?.totalElements ?? 0,
    inactive: (exitedCount?.totalElements ?? 0) + (termCount?.totalElements ?? 0),
  }

  const resetPage = useCallback(() => setPage(0), [])

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 sm:p-8">
      {/* Header */}
      <HrPageHeader
        crumb="Master"
        title="Workforce Directory"
        subtitle={`${activeCompany ? `${activeCompany.name} · ` : ''}${total} employees`}
        actions={
          <>
            <HrButton variant="ghost" onClick={() => navigate('/hrms/organization')}>
              <Building2 size={15} /> Org Setup
            </HrButton>
            <Can code={P.HRMS_EMPLOYEE_IMPORT}>
              <HrButton variant="ghost" onClick={() => navigate('/hrms/employees/import')}>
                <Upload size={15} /> Import
              </HrButton>
            </Can>
            {canWrite && !noCompany && (
              <HrButton onClick={() => setShowForm(true)}>
                <Plus size={15} /> Add Employee
              </HrButton>
            )}
          </>
        }
      />

      {noCompany ? (
        <EmptyState
          title="No companies yet"
          description={canCreateCompany
            ? 'Create a company before you can add employees.'
            : 'Ask an admin to set up a company first.'}
          primaryAction={canCreateCompany
            ? { label: 'Create a company', onClick: () => navigate('/hrms/organization') }
            : undefined}
        />
      ) : (
      <>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <HrStatCard icon={<Users size={18} />}     color="blue"   value={statusCounts.total}    label="Total"     loading={isLoading} />
        <HrStatCard icon={<UserCheck size={18} />}  color="green"  value={statusCounts.active}   label="Active"    loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />}      color="orange" value={statusCounts.onLeave}  label="On Notice" loading={isLoading} />
        <HrStatCard icon={<UserX size={18} />}      color="red"    value={statusCounts.inactive} label="Exited"    loading={isLoading} />
      </div>

      {/* Table card with toolbar (search + filters) */}
      {isLoading ? (
        <TableSkeleton />
      ) : dirError ? (
        <EmptyState
          variant="error"
          title="Failed to load employees"
          description={(dirError as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => refetch() }}
        />
      ) : (
      <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <TableCard
        search={{ value: search, onChange: (v) => { setSearch(v); resetPage() }, placeholder: 'Search name, code, email…' }}
        actions={
          <>
            <select
              value={departmentId}
              onChange={(e) => { setDepartmentId(e.target.value); resetPage() }}
              className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-sm focus:border-[#FF9D00] focus:outline-none"
            >
              <option value="">All Departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select
              value={branchId}
              onChange={(e) => { setBranchId(e.target.value); resetPage() }}
              className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-sm focus:border-[#FF9D00] focus:outline-none"
            >
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); resetPage() }}
              className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-sm focus:border-[#FF9D00] focus:outline-none"
            >
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {(search || departmentId || branchId || status) && (
              <button
                onClick={() => { setSearch(''); setDepartmentId(''); setBranchId(''); setStatus(''); resetPage() }}
                className="whitespace-nowrap px-2.5 py-1.5 text-sm font-semibold text-[#C16E00] hover:bg-[#FFF4E1] rounded-lg"
              >
                Clear filters
              </button>
            )}
          </>
        }
        footer={total > 0 ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-secondary">
              Showing <span className="font-semibold text-text-primary">{page * 25 + 1}–{Math.min((page + 1) * 25, total)}</span> of <span className="font-semibold text-text-primary">{total}</span>
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 0}
                className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40">
                <ChevronLeft size={15} />
              </button>
              <span className="px-1 text-xs font-semibold text-text-primary">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}
                className="rounded-lg border border-border-default p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        ) : undefined}
      >
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="hidden sm:table-cell">Code</th>
              <th className="hidden md:table-cell">Department</th>
              <th className="hidden lg:table-cell">Branch</th>
              <th className="hidden lg:table-cell">Type</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-bg-base">
                    <Users size={22} className="text-text-tertiary" />
                  </div>
                  <p className="text-sm font-semibold text-text-secondary">No employees found</p>
                  {(search || departmentId || branchId || status) && <p className="mt-1 text-xs text-text-tertiary">Try adjusting your search or filters</p>}
                </td>
              </tr>
            ) : employees.map((emp, i) => {
              const label = STATUS_STYLE[emp.employmentStatus ?? '']?.label ?? emp.employmentStatus ?? '—'
              const tone = STATUS_TONE[emp.employmentStatus ?? ''] ?? 'gray'
              const dept = departments.find((d) => d.id === emp.departmentId)
              const br = branches.find((b) => b.id === emp.branchId)
              return (
                <tr key={emp.id} onClick={() => navigate(`/hrms/employees/${emp.id}`)} className="cursor-pointer">
                  <td><HrAvatar name={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} sub={emp.email} seed={i + (emp.employeeCode?.length ?? 0)} /></td>
                  <td className="hidden sm:table-cell"><span className="hr-mono">{emp.employeeCode}</span></td>
                  <td className="hidden md:table-cell text-text-secondary">{dept?.name ?? '—'}</td>
                  <td className="hidden lg:table-cell text-text-secondary">{br?.name ?? '—'}</td>
                  <td className="hidden lg:table-cell text-text-secondary">{emp.employmentType?.replace('_', ' ') ?? '—'}</td>
                  <td><HrStatusPill tone={tone}>{label}</HrStatusPill></td>
                  <td className="hidden sm:table-cell text-text-secondary whitespace-nowrap">
                    {emp.dateOfJoining ? format(new Date(emp.dateOfJoining), 'd MMM yyyy') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableCard>
      </div>
      )}
      </>
      )}

      {showForm && <EmployeeForm onClose={() => setShowForm(false)} onSuccess={() => toast('Employee added', 'success')} />}
    </div>
  )
}
