import React, { useState } from 'react'
import { Plus, Search, Mail, User, Shield, MoreVertical } from 'lucide-react'
import { clsx } from 'clsx'
import { usePlatformUsers, useCreatePlatformUser } from '../modules/rbac/api/usePlatformUsers'
import { useCompanies } from '../modules/hrms/api/useOrg'
import { useToast } from '@/shared/hooks/useToast'
import { apiJson } from '@/core/api/client'

export const Users: React.FC = () => {
  const { data: users = [], isLoading } = usePlatformUsers()
  const [searchTerm, setSearchTerm] = useState('')
  const [isInviteOpen, setIsInviteOpen] = useState(false)

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-brand-cream relative animate-fade-in font-body">
      {/* Header */}
      <div className="px-8 py-8 border-b border-brand-100 bg-white">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-brand-900 tracking-tight font-heading">Workspace Users</h1>
            <p className="text-sm text-brand-600 mt-1">{users.length} members in your workspace</p>
          </div>
          <button
            onClick={() => setIsInviteOpen(true)}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-[#0F172A] px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm shadow-brand-600/20 hover:shadow-md hover:-translate-y-0.5"
          >
            <Plus size={18} /> Invite User
          </button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
          <input
            type="text"
            placeholder="Search users by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-brand-50 border-2 border-brand-100 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10 transition-all placeholder:text-brand-300 text-brand-900"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 p-8 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-brand-100 border-dashed shadow-sm">
            <div className="mx-auto w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mb-4">
              <User className="text-brand-400" size={32} />
            </div>
            <h3 className="text-lg font-bold text-brand-900 font-heading">No users found</h3>
            <p className="text-sm text-brand-600 mt-1">Try adjusting your search or invite a new user.</p>
          </div>
        ) : (
          <div className="bg-white border border-brand-100 rounded-3xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 border-b border-brand-100 text-left text-xs font-bold text-brand-800 uppercase tracking-wider">
                  <th className="px-6 py-4 font-bold">User</th>
                  <th className="px-6 py-4 font-bold">Roles</th>
                  <th className="px-6 py-4 font-bold">Status</th>
                  <th className="px-6 py-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-brand-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center text-brand-600 font-bold border border-brand-200">
                          {user.email.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-brand-900">{user.email}</p>
                          {user.mobileNumber && <p className="text-xs text-brand-500 mt-0.5">{user.mobileNumber}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {user.roles.map((r, i) => (
                          <span key={i} className="px-2.5 py-1 bg-brand-100 text-brand-700 text-xs font-bold rounded-lg border border-brand-200">
                            {r.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx('px-3 py-1 text-xs font-bold rounded-lg border', 
                        user.active ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-[#64748B] border-slate-200'
                      )}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-xl transition-colors opacity-0 group-hover:opacity-100">
                        <MoreVertical size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isInviteOpen && <InviteUserModal onClose={() => setIsInviteOpen(false)} />}
    </div>
  )
}

function InviteUserModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreatePlatformUser()
  const { data: companies = [] } = useCompanies()
  
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('WORKSPACE_USER')
  const [createEmployee, setCreateEmployee] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInvite = async () => {
    if (!email.trim()) {
      toast('Email is required', 'error')
      return
    }
    
    setIsSubmitting(true)
    try {
      if (createEmployee) {
        if (!firstName.trim() || !lastName.trim()) {
          toast('First and Last name required to create Employee', 'error')
          setIsSubmitting(false)
          return
        }
        
        const companyId = companies[0]?.id
        if (!companyId) {
          toast('No company found to assign employee', 'error')
          setIsSubmitting(false)
          return
        }
        
        await apiJson('/v1/employees/staff', {
          method: 'POST',
          body: JSON.stringify({
            employee: {
              firstName,
              lastName,
              email,
              companyId
            },
            roles: [role]
          })
        })
        toast('HRMS Employee & User created successfully', 'success')
      } else {
        await create.mutateAsync({ email, roles: [role] })
        toast('Workspace User invited successfully', 'success')
      }
      onClose()
    } catch (err: any) {
      toast(err.message || 'Failed to invite user', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-brand-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-brand-100">
        <div className="px-8 py-6 border-b border-brand-100 bg-brand-50/50">
          <h3 className="text-xl font-bold text-brand-900 tracking-tight font-heading">Invite Workspace User</h3>
          <p className="text-sm text-brand-600 mt-1">Add a new user to your ERP platform.</p>
        </div>
        
        <div className="p-8 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-bold text-brand-800 mb-2">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white border-2 border-brand-100 rounded-2xl pl-11 pr-4 py-3 text-sm text-brand-900 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all placeholder:text-brand-300"
                placeholder="name@company.com"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-bold text-brand-800 mb-2">Workspace Role</label>
            <div className="relative">
              <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
              <select 
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full bg-white border-2 border-brand-100 rounded-2xl pl-11 pr-4 py-3 text-sm text-brand-900 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all appearance-none font-bold"
              >
                <option value="WORKSPACE_USER">Employee / Basic Access</option>
                <option value="COMPANY_ADMIN">Workspace Admin</option>
                <option value="HR_MANAGER">HR Manager</option>
              </select>
            </div>
          </div>
          
          <div className="pt-4 border-t border-brand-100">
            <label className="flex items-start gap-3 cursor-pointer group p-4 rounded-2xl border-2 border-brand-100 hover:border-brand-300 hover:bg-brand-50 transition-colors">
              <div className="mt-0.5">
                <input
                  type="checkbox"
                  checked={createEmployee}
                  onChange={e => setCreateEmployee(e.target.checked)}
                  className="w-5 h-5 rounded border-brand-300 text-brand-600 focus:ring-brand-500 focus:ring-offset-0 transition-all cursor-pointer"
                />
              </div>
              <div>
                <span className="block text-sm font-bold text-brand-900">Also create HRMS Employee</span>
                <span className="block text-xs text-brand-500 mt-1 leading-relaxed">
                  Automatically provisions a payroll/directory record in the HRMS module for this user.
                </span>
              </div>
            </label>
          </div>

          {createEmployee && (
            <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-brand-700 mb-2">First Name</label>
                  <input 
                    type="text" 
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full bg-white border-2 border-brand-100 rounded-xl px-4 py-2.5 text-sm text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-brand-700 mb-2">Last Name</label>
                  <input 
                    type="text" 
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full bg-white border-2 border-brand-100 rounded-xl px-4 py-2.5 text-sm text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="px-8 py-5 bg-brand-50 border-t border-brand-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-brand-600 hover:text-brand-800 hover:bg-brand-100 rounded-xl transition-all">Cancel</button>
          <button 
            onClick={handleInvite}
            disabled={isSubmitting || create.isPending}
            className="px-6 py-2.5 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-[#0F172A] text-sm font-bold rounded-xl transition-all shadow-md shadow-brand-500/30 disabled:opacity-50"
          >
            {isSubmitting || create.isPending ? 'Processing...' : 'Send Invite'}
          </button>
        </div>
      </div>
    </>
  )
}
