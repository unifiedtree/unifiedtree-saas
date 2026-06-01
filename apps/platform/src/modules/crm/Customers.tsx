import React, { useState } from 'react'
import { Search, Users, DollarSign, Globe } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

interface Customer {
  id: string
  name: string
  company: string
  email: string
  phone: string
  country: string
  totalRevenue: number
  status: 'ACTIVE' | 'INACTIVE'
  since: string
  deals: number
}

const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Kavya Reddy', company: 'TechStart Inc', email: 'kavya@techstart.com', phone: '+91 9876543210', country: 'India', totalRevenue: 350000, status: 'ACTIVE', since: '2023-03-15', deals: 3 },
  { id: 'c2', name: 'Arjun Singh', company: 'GlobalCorp', email: 'arjun@globalcorp.com', phone: '+91 9876543211', country: 'India', totalRevenue: 280000, status: 'ACTIVE', since: '2023-06-20', deals: 2 },
  { id: 'c3', name: 'Maria Santos', company: 'Innovate.io', email: 'maria@innovate.io', phone: '+55 11987654321', country: 'Brazil', totalRevenue: 96000, status: 'ACTIVE', since: '2024-01-10', deals: 1 },
  { id: 'c4', name: 'James Lee', company: 'Next Solutions', email: 'james@nextsolutions.com', phone: '+1 2025551234', country: 'USA', totalRevenue: 145000, status: 'INACTIVE', since: '2022-11-05', deals: 2 },
  { id: 'c5', name: 'Priyanka Nair', company: 'FutureTech India', email: 'priyanka@futuretech.in', phone: '+91 9876543215', country: 'India', totalRevenue: 420000, status: 'ACTIVE', since: '2023-09-01', deals: 4 },
  { id: 'c6', name: 'Ahmed Khalil', company: 'Dubai Biz', email: 'ahmed@dubaibiz.ae', phone: '+971 501234567', country: 'UAE', totalRevenue: 380000, status: 'ACTIVE', since: '2024-02-14', deals: 2 },
  { id: 'c7', name: 'Fatima Al-Hassan', company: 'MegaTech ME', email: 'fatima@megatech.ae', phone: '+971 509876543', country: 'UAE', totalRevenue: 75000, status: 'ACTIVE', since: '2024-04-22', deals: 1 },
  { id: 'c8', name: 'Yuki Tanaka', company: 'JP Tech', email: 'yuki@jptech.co.jp', phone: '+81 9012345678', country: 'Japan', totalRevenue: 320000, status: 'ACTIVE', since: '2023-12-01', deals: 2 },
  { id: 'c9', name: 'Isabella Rossi', company: 'IT Consult EU', email: 'isabella@itconsult.eu', phone: '+39 3201234567', country: 'Italy', totalRevenue: 160000, status: 'ACTIVE', since: '2024-03-10', deals: 1 },
  { id: 'c10', name: 'Lucas Oliveira', company: 'SoftBR', email: 'lucas@softbr.com', phone: '+55 11999887766', country: 'Brazil', totalRevenue: 95000, status: 'ACTIVE', since: '2024-05-18', deals: 1 },
  { id: 'c11', name: 'Amara Diallo', company: 'AfricaTech', email: 'amara@africatech.org', phone: '+221 771234567', country: 'Senegal', totalRevenue: 48000, status: 'INACTIVE', since: '2024-06-30', deals: 1 },
  { id: 'c12', name: 'Sofia Herrera', company: 'LatinSoft', email: 'sofia@latinsoft.co', phone: '+52 5512345678', country: 'Mexico', totalRevenue: 42000, status: 'ACTIVE', since: '2024-08-15', deals: 1 },
]

export const Customers: React.FC = () => {
  const [search, setSearch] = useState('')

  const filtered = MOCK_CUSTOMERS.filter((c) => {
    const q = search.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.includes(q)
  })

  const active = MOCK_CUSTOMERS.filter((c) => c.status === 'ACTIVE').length
  const totalRevenue = MOCK_CUSTOMERS.reduce((s, c) => s + c.totalRevenue, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Customers</h1>
        <p className="text-[#64748B] text-sm mt-0.5">{MOCK_CUSTOMERS.length} total customers</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Customers" value={MOCK_CUSTOMERS.length} icon={Users} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
        <StatCard title="Active" value={active} icon={Users} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Total Revenue" value={`$${(totalRevenue / 1000).toFixed(0)}k`} icon={DollarSign} iconColor="text-purple-400" iconBg="bg-purple-500/10" />
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers..." className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['Customer', 'Company', 'Country', 'Revenue', 'Deals', 'Status', 'Since'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr key={customer.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center text-[#0F172A] text-xs font-bold flex-shrink-0">
                        {customer.name[0]}
                      </div>
                      <div>
                        <p className="text-[#0F172A] font-medium">{customer.name}</p>
                        <p className="text-[#64748B] text-xs">{customer.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#64748B]">{customer.company}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[#64748B]">
                      <Globe size={12} className="text-slate-600" />
                      {customer.country}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#0F172A] font-semibold">${(customer.totalRevenue / 1000).toFixed(0)}k</td>
                  <td className="px-4 py-3 text-[#64748B]">{customer.deals}</td>
                  <td className="px-4 py-3">
                    <span className={customer.status === 'ACTIVE' ? 'text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full text-xs font-medium' : 'text-[#64748B] bg-[#F1F5F9]/40 px-2 py-0.5 rounded-full text-xs font-medium'}>
                      {customer.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#64748B] text-xs">{new Date(customer.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
