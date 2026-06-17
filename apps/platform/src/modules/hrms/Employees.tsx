import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Upload, Users, UserCheck, UserX, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { Can, usePermission, P } from '@unifiedtree/sdk'
import { TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import { useEmployeeDirectory, type EmploymentStatus } from './api/useWorkforce'
import { useCompanies, useDepartments, useBranches } from './api/useOrg'
import { EmployeeForm } from './employees/EmployeeForm'
import { useDebounce } from '@/shared/hooks/useDebounce'

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE: { label: 'Active', color: 'text-success', bg: 'bg-success/10 border-success/20' },
  PROBATION: { label: 'Probation', color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
  ON_NOTICE: { label: 'Notice', color: 'text-orange-600', bg: 'bg-orange-100 border-orange-200' },
  DRAFT: { label: 'Draft', color: 'text-text-tertiary', bg: 'bg-bg-surface border-border-default' },
  INVITED: { label: 'Invited', color: 'text-accent-default', bg: 'bg-accent-subtle border-accent-default/20' },
  EXITED: { label: 'Exited', color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
  TERMINATED: { label: 'Terminated', color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
}

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'ON_NOTICE', label: 'On Notice' },
  { value: 'EXITED', label: 'Exited' },
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

  const statusCounts = {
    total,
    active: employees.filter((e) => e.employmentStatus === 'ACTIVE').length,
    onLeave: employees.filter((e) => e.employmentStatus === 'ON_NOTICE').length,
    inactive: employees.filter((e) => e.employmentStatus === 'EXITED' || e.employmentStatus === 'TERMINATED').length,
  }

  const resetPage = useCallback(() => setPage(0), [])

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary font-heading tracking-tight">Employees</h1>
          <p className="text-text-secondary text-sm sm:text-base font-medium mt-1.5">
            {activeCompany ? `${activeCompany.name} · ` : ''}{total} employees
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/hrms/organization')}
            className="px-4 py-2 bg-white hover:bg-bg-surface border border-border-default text-text-primary text-sm font-bold rounded-xl transition-all shadow-sm"
          >
            Org Setup
          </button>
          <Can code={P.HRMS_EMPLOYEE_IMPORT}>
            <button
              onClick={() => navigate('/hrms/employees/import')}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-bg-surface border border-border-default text-text-primary text-sm font-bold rounded-xl transition-all shadow-sm"
            >
              <Upload size={16} /> Import
            </button>
          </Can>
          {canWrite && !noCompany && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-bold rounded-xl transition-all shadow-sm shadow-primary/30"
            >
              <Plus size={16} /> Add Employee
            </button>
          )}
        </div>
      </div>

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: total, icon: Users, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'Active', value: statusCounts.active, icon: UserCheck, color: 'text-success', bg: 'bg-success/10' },
          { label: 'On Notice', value: statusCounts.onLeave, icon: Clock, color: 'text-warning', bg: 'bg-warning/10' },
          { label: 'Exited', value: statusCounts.inactive, icon: UserX, color: 'text-danger', bg: 'bg-danger/10' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-border-default rounded-2xl p-5 shadow-sm flex items-center gap-4 transition-transform hover:-translate-y-1 hover:shadow-md duration-300">
            <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', s.bg)}>
              <s.icon size={20} className={s.color} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-text-primary font-heading">{isLoading ? '—' : s.value}</p>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-2xl border border-border-default shadow-sm">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage() }}
            placeholder="Search name, code, email…"
            className="w-full bg-bg-surface border border-border-default rounded-xl pl-9 pr-4 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
          />
        </div>
        <select
          value={departmentId}
          onChange={(e) => { setDepartmentId(e.target.value); resetPage() }}
          className="bg-bg-surface border border-border-default rounded-xl px-4 py-2 text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select
          value={branchId}
          onChange={(e) => { setBranchId(e.target.value); resetPage() }}
          className="bg-bg-surface border border-border-default rounded-xl px-4 py-2 text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
        >
          <option value="">All Branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); resetPage() }}
          className="bg-bg-surface border border-border-default rounded-xl px-4 py-2 text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
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
      <div className={clsx('bg-white border border-border-default rounded-2xl shadow-sm overflow-hidden transition-opacity', isFetching && 'opacity-70')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-border-default bg-bg-surface">
                <th className="px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Employee</th>
                <th className="hidden sm:table-cell px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Code</th>
                <th className="hidden md:table-cell px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Department</th>
                <th className="hidden lg:table-cell px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Branch</th>
                <th className="hidden lg:table-cell px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Type</th>
                <th className="px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Status</th>
                <th className="hidden sm:table-cell px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider whitespace-nowrap">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {employees.length === 0
                ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-surface mb-3">
                          <Users size={24} className="text-text-tertiary" />
                        </div>
                        <p className="text-sm font-bold text-text-secondary">No employees found</p>
                        {search && <p className="text-xs mt-1 text-text-tertiary font-medium">Try adjusting your search or filters</p>}
                      </td>
                    </tr>
                  )
                : employees.map((emp) => {
                    const sc = STATUS_STYLE[emp.employmentStatus ?? 'ACTIVE'] ?? STATUS_STYLE['ACTIVE']
                    const initials = (emp.firstName[0] ?? '') + (emp.lastName?.[0] ?? '')
                    const dept = departments.find((d) => d.id === emp.departmentId)
                    const br = branches.find((b) => b.id === emp.branchId)
                    return (
                      <tr
                        key={emp.id}
                        onClick={() => navigate(`/hrms/employees/${emp.id}`)}
                        className="hover:bg-interactive-hover cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center text-primary text-xs font-bold flex-shrink-0 shadow-sm">
                              {initials.toUpperCase()}
                            </div>
                            <div>
                              <p className="text-text-primary font-bold text-sm">{emp.firstName} {emp.lastName}</p>
                              <p className="text-text-secondary text-xs font-medium mt-0.5">{emp.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-6 py-4 text-text-secondary font-mono text-sm whitespace-nowrap">{emp.employeeCode}</td>
                        <td className="hidden md:table-cell px-6 py-4 text-text-secondary text-sm font-medium">{dept?.name ?? '—'}</td>
                        <td className="hidden lg:table-cell px-6 py-4 text-text-secondary text-sm font-medium">{br?.name ?? '—'}</td>
                        <td className="hidden lg:table-cell px-6 py-4 text-text-secondary text-sm font-medium">{emp.employmentType?.replace('_', ' ') ?? '—'}</td>
                        <td className="px-6 py-4">
                          <span className={clsx('px-2.5 py-1 text-xs font-bold rounded-lg border shadow-sm', sc.bg, sc.color)}>{sc.label}</span>
                        </td>
                        <td className="hidden sm:table-cell px-6 py-4 text-text-secondary text-sm font-medium whitespace-nowrap">
                          {emp.dateOfJoining ? format(new Date(emp.dateOfJoining), 'd MMM yyyy') : '—'}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <div className="flex items-center justify-between px-6 py-4 bg-bg-surface border-t border-border-default">
            <p className="text-xs font-medium text-text-secondary">
              Showing <span className="font-bold text-text-primary">{page * 25 + 1}–{Math.min((page + 1) * 25, total)}</span> of <span className="font-bold text-text-primary">{total}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-white disabled:opacity-50 border border-transparent disabled:hover:bg-transparent rounded-lg transition-colors shadow-sm"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold text-text-primary px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-white disabled:opacity-50 border border-transparent disabled:hover:bg-transparent rounded-lg transition-colors shadow-sm"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      )}
      </>
      )}

      {showForm && <EmployeeForm onClose={() => setShowForm(false)} onSuccess={() => toast('Employee added', 'success')} />}
    </div>
  )
}
