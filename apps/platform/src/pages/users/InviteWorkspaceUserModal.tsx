import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Modal, Button, Field, Input } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore } from '@/core/auth/authStore'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import {
  useAssignableRoles, useInviteWorkspaceUser, groupRolesByModule,
} from '@/modules/rbac/api/useWorkspaceAccess'

const MODULE_LABEL: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts',
  attendance: 'Attendance', leave: 'Leave', core: 'Platform',
}

interface Props { open: boolean; onClose: () => void }

export const InviteWorkspaceUserModal: React.FC<Props> = ({ open, onClose }) => {
  const { toast } = useToast()
  const hasModule = useAuthStore(s => s.hasModule)
  const { data: companies = [] } = useCompanies()
  const { data: roles = [] } = useAssignableRoles()
  const invite = useInviteWorkspaceUser()

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [createEmployee, setCreateEmployee] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(['EMPLOYEE']))

  const groups = useMemo(() => groupRolesByModule(roles), [roles])

  const toggleRole = (code: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(code) ? next.delete(code) : next.add(code)
    return next
  })

  const handleInvite = () => {
    if (!email.trim()) { toast('Email is required', 'error'); return }
    const companyId = createEmployee ? companies[0]?.id : undefined
    if (createEmployee && !companyId) { toast('No company found to create employee', 'error'); return }

    invite.mutate({
      email: email.trim(),
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      createEmployee,
      roleCodes: [...selected],
      companyId,
    }, {
      onSuccess: () => {
        toast(createEmployee ? 'User invited and HRMS employee created' : 'User invited', 'success')
        onClose()
      },
      onError: (e) => toast((e as Error).message || 'Failed to invite user', 'error'),
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Invite Workspace User"
      description="Add a teammate and grant their access."
      size="md"
    >
      <div className="space-y-5">
        <Field label="Email" required>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="First name">
            <Input value={firstName} onChange={e => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={lastName} onChange={e => setLastName(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 p-3.5 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={createEmployee}
            onChange={e => setCreateEmployee(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-[#0F6E56]"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-900">Also create HRMS employee</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              Creates a payroll/directory record in HRMS. Uncheck to grant login + roles only
              (the user won't appear in the HRMS employee directory).
            </span>
          </span>
        </label>

        <div>
          <p className="text-sm font-semibold text-slate-800 mb-2">Roles</p>
          <div className="space-y-4">
            {groups.map(([moduleKey, moduleRoles]) => {
              const active = moduleKey === 'core' || hasModule(moduleKey)
              return (
                <div key={moduleKey}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-1.5">
                    {MODULE_LABEL[moduleKey] ?? moduleKey}
                  </p>
                  <div className="space-y-1">
                    {moduleRoles.map(role => (
                      <label
                        key={role.roleCode}
                        className={clsx(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                          active ? 'cursor-pointer hover:bg-slate-50 text-slate-800' : 'opacity-60 text-slate-400',
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={!active}
                          checked={selected.has(role.roleCode)}
                          onChange={() => toggleRole(role.roleCode)}
                          className="h-4 w-4 rounded accent-[#0F6E56]"
                        />
                        {role.displayName}
                      </label>
                    ))}
                  </div>
                  {!active && (
                    <p className="text-xs text-slate-500 pl-2.5 pt-0.5">
                      Activate this module to assign roles.{' '}
                      <Link to="/settings" className="font-semibold text-[#0F6E56] hover:underline">
                        Activate {MODULE_LABEL[moduleKey] ?? moduleKey} →
                      </Link>
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={invite.isPending} onClick={handleInvite}>Send invite</Button>
      </div>
    </Modal>
  )
}
