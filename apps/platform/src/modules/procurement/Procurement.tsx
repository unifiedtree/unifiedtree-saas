import React, { useState } from 'react'
import {
  Search,
  Plus,
  ShoppingCart,
  Clock,
  DollarSign,
  Users,
  Package,
  Building2,
  Mail,
  MapPin,
  CreditCard,
  Eye,
  CheckCircle,
  Send,
} from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'

// ─── Types ───────────────────────────────────────────────────────────────────

type POStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RECEIVED' | 'CANCELLED'
type VendorStatus = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD'

interface PurchaseOrder {
  id: string
  orderNumber: string
  vendorName: string
  orderDate: string
  expectedDelivery: string
  totalAmount: number
  status: POStatus
  itemCount: number
}

interface Vendor {
  id: string
  name: string
  contactPerson: string
  email: string
  phone: string
  city: string
  country: string
  paymentTerms: string
  status: VendorStatus
  totalOrders: number
  totalValue: number
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po1',
    orderNumber: 'PO-2025-001',
    vendorName: 'TechSupply Co.',
    orderDate: '2025-01-03',
    expectedDelivery: '2025-01-20',
    totalAmount: 84500,
    status: 'APPROVED',
    itemCount: 12,
  },
  {
    id: 'po2',
    orderNumber: 'PO-2025-002',
    vendorName: 'Global Parts Ltd.',
    orderDate: '2025-01-05',
    expectedDelivery: '2025-01-25',
    totalAmount: 32000,
    status: 'SUBMITTED',
    itemCount: 5,
  },
  {
    id: 'po3',
    orderNumber: 'PO-2025-003',
    vendorName: 'Omega Supplies',
    orderDate: '2025-01-07',
    expectedDelivery: '2025-02-05',
    totalAmount: 156000,
    status: 'RECEIVED',
    itemCount: 28,
  },
  {
    id: 'po4',
    orderNumber: 'PO-2025-004',
    vendorName: 'InfraKit India',
    orderDate: '2025-01-09',
    expectedDelivery: '2025-02-01',
    totalAmount: 47800,
    status: 'DRAFT',
    itemCount: 7,
  },
  {
    id: 'po5',
    orderNumber: 'PO-2025-005',
    vendorName: 'TechSupply Co.',
    orderDate: '2025-01-10',
    expectedDelivery: '2025-01-28',
    totalAmount: 21500,
    status: 'SUBMITTED',
    itemCount: 3,
  },
  {
    id: 'po6',
    orderNumber: 'PO-2025-006',
    vendorName: 'Meridian Electronics',
    orderDate: '2025-01-11',
    expectedDelivery: '2025-02-10',
    totalAmount: 98000,
    status: 'APPROVED',
    itemCount: 15,
  },
  {
    id: 'po7',
    orderNumber: 'PO-2025-007',
    vendorName: 'Global Parts Ltd.',
    orderDate: '2025-01-12',
    expectedDelivery: '2025-02-15',
    totalAmount: 63250,
    status: 'DRAFT',
    itemCount: 9,
  },
  {
    id: 'po8',
    orderNumber: 'PO-2025-008',
    vendorName: 'BuildRight Materials',
    orderDate: '2025-01-08',
    expectedDelivery: '2025-01-18',
    totalAmount: 19900,
    status: 'CANCELLED',
    itemCount: 4,
  },
]

const MOCK_VENDORS: Vendor[] = [
  {
    id: 'v1',
    name: 'TechSupply Co.',
    contactPerson: 'Rajesh Sharma',
    email: 'rajesh@techsupply.com',
    phone: '+91 98765 43210',
    city: 'Mumbai',
    country: 'India',
    paymentTerms: 'Net 30',
    status: 'ACTIVE',
    totalOrders: 24,
    totalValue: 480000,
  },
  {
    id: 'v2',
    name: 'Global Parts Ltd.',
    contactPerson: 'Sarah Thompson',
    email: 'sarah@globalparts.co.uk',
    phone: '+44 20 7946 0210',
    city: 'London',
    country: 'United Kingdom',
    paymentTerms: 'Net 45',
    status: 'ACTIVE',
    totalOrders: 18,
    totalValue: 362000,
  },
  {
    id: 'v3',
    name: 'Omega Supplies',
    contactPerson: 'Fatima Al-Rashid',
    email: 'fatima@omegasupplies.ae',
    phone: '+971 4 456 7890',
    city: 'Dubai',
    country: 'UAE',
    paymentTerms: 'Net 15',
    status: 'ACTIVE',
    totalOrders: 31,
    totalValue: 715000,
  },
  {
    id: 'v4',
    name: 'InfraKit India',
    contactPerson: 'Pradeep Nair',
    email: 'pradeep@infrakit.in',
    phone: '+91 80 4567 8901',
    city: 'Bangalore',
    country: 'India',
    paymentTerms: 'Net 30',
    status: 'ACTIVE',
    totalOrders: 11,
    totalValue: 198500,
  },
  {
    id: 'v5',
    name: 'Meridian Electronics',
    contactPerson: 'Chen Wei',
    email: 'chenwei@meridian-elec.cn',
    phone: '+86 21 6789 0123',
    city: 'Shanghai',
    country: 'China',
    paymentTerms: 'Net 60',
    status: 'ON_HOLD',
    totalOrders: 8,
    totalValue: 142000,
  },
  {
    id: 'v6',
    name: 'BuildRight Materials',
    contactPerson: 'James O\'Brien',
    email: 'james@buildright.us',
    phone: '+1 312 555 0178',
    city: 'Chicago',
    country: 'USA',
    paymentTerms: 'Net 30',
    status: 'INACTIVE',
    totalOrders: 5,
    totalValue: 87500,
  },
]

// ─── Status Config ─────────────────────────────────────────────────────────────

const poStatusConfig: Record<POStatus, { label: string; color: string; bg: string }> = {
  DRAFT:     { label: 'Draft',     color: 'text-[#64748B]',  bg: 'bg-[#F1F5F9]/40' },
  SUBMITTED: { label: 'Submitted', color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  APPROVED:  { label: 'Approved',  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  RECEIVED:  { label: 'Received',  color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400',    bg: 'bg-red-500/10' },
}

const vendorStatusConfig: Record<VendorStatus, { label: string; color: string; bg: string }> = {
  ACTIVE:   { label: 'Active',   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  INACTIVE: { label: 'Inactive', color: 'text-[#64748B]',   bg: 'bg-[#F1F5F9]/40' },
  ON_HOLD:  { label: 'On Hold',  color: 'text-amber-400',   bg: 'bg-amber-500/10' },
}

type Tab = 'orders' | 'vendors'
const PO_STATUSES: POStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'CANCELLED']

// ─── Component ────────────────────────────────────────────────────────────────

export const Procurement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('orders')
  const [poSearch, setPoSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | POStatus>('All')
  const [vendorSearch, setVendorSearch] = useState('')

  // Purchase Orders derived stats
  const totalOrders = MOCK_PURCHASE_ORDERS.length
  const pendingApproval = MOCK_PURCHASE_ORDERS.filter((o) => o.status === 'SUBMITTED').length
  const thisMonthValue = MOCK_PURCHASE_ORDERS.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.totalAmount, 0)
  const activeVendors = MOCK_VENDORS.filter((v) => v.status === 'ACTIVE').length

  // Vendor derived stats
  const totalVendors = MOCK_VENDORS.length
  const totalOrdersValue = MOCK_VENDORS.reduce((s, v) => s + v.totalValue, 0)

  // Filtered purchase orders
  const filteredOrders = MOCK_PURCHASE_ORDERS.filter((o) => {
    const q = poSearch.toLowerCase()
    return (
      (!q || o.orderNumber.toLowerCase().includes(q) || o.vendorName.toLowerCase().includes(q)) &&
      (statusFilter === 'All' || o.status === statusFilter)
    )
  })

  // Filtered vendors
  const filteredVendors = MOCK_VENDORS.filter((v) => {
    const q = vendorSearch.toLowerCase()
    return (
      !q ||
      v.name.toLowerCase().includes(q) ||
      v.contactPerson.toLowerCase().includes(q) ||
      v.city.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Procurement</h1>
          <p className="text-[#64748B] text-sm mt-0.5">
            {activeTab === 'orders'
              ? `${totalOrders} purchase orders this period`
              : `${totalVendors} vendors registered`}
          </p>
        </div>
        {activeTab === 'orders' ? (
          <button className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-[#0F172A] text-sm font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20">
            <Plus size={16} /> New Purchase Order
          </button>
        ) : (
          <button className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-[#0F172A] text-sm font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20">
            <Plus size={16} /> Add Vendor
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 bg-white border border-[#E2E8F0]/40 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('orders')}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'orders'
              ? 'bg-[#F1F5F9] text-[#0F172A] shadow-sm'
              : 'text-[#64748B] hover:text-[#334155]',
          )}
        >
          <ShoppingCart size={14} /> Purchase Orders
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'vendors'
              ? 'bg-[#F1F5F9] text-[#0F172A] shadow-sm'
              : 'text-[#64748B] hover:text-[#334155]',
          )}
        >
          <Building2 size={14} /> Vendors
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════
          PURCHASE ORDERS TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'orders' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Total Orders"
              value={totalOrders}
              icon={ShoppingCart}
              iconColor="text-[#0F6E56]"
              iconBg="bg-[#0F6E56]/10"
              change="+3 this week"
              changeType="positive"
            />
            <StatCard
              title="Pending Approval"
              value={pendingApproval}
              icon={Clock}
              iconColor="text-amber-400"
              iconBg="bg-amber-500/10"
              change="Awaiting review"
              changeType="neutral"
            />
            <StatCard
              title="This Month Value"
              value={`$${(thisMonthValue / 1000).toFixed(0)}k`}
              icon={DollarSign}
              iconColor="text-emerald-400"
              iconBg="bg-emerald-500/10"
              change="+12% vs last month"
              changeType="positive"
            />
            <StatCard
              title="Active Vendors"
              value={activeVendors}
              icon={Users}
              iconColor="text-blue-400"
              iconBg="bg-blue-500/10"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
              <input
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
                placeholder="Search by order # or vendor..."
                className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | POStatus)}
              className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="All">All Status</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {poStatusConfig[s].label}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0]">
                    {[
                      'Order #',
                      'Vendor',
                      'Order Date',
                      'Expected Delivery',
                      'Total Amount',
                      'Status',
                      'Actions',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const sc = poStatusConfig[order.status]
                    return (
                      <tr
                        key={order.id}
                        className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[#0F6E56] font-mono font-medium">{order.orderNumber}</span>
                            <span className="text-slate-600 text-xs">({order.itemCount} items)</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#0F172A]">{order.vendorName}</td>
                        <td className="px-4 py-3 text-[#64748B] text-xs whitespace-nowrap">
                          {new Date(order.orderDate).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-[#64748B] text-xs whitespace-nowrap">
                          {new Date(order.expectedDelivery).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-[#0F172A] font-semibold">
                          ${order.totalAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              'px-2 py-0.5 text-xs font-medium rounded-full',
                              sc.bg,
                              sc.color,
                            )}
                          >
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 text-xs">
                            <button className="flex items-center gap-1 text-[#64748B] hover:text-[#0F6E56] transition-colors">
                              <Eye size={12} /> View
                            </button>
                            {order.status === 'DRAFT' && (
                              <button className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors">
                                <Send size={12} /> Submit
                              </button>
                            )}
                            {order.status === 'SUBMITTED' && (
                              <button className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors">
                                <CheckCircle size={12} /> Approve
                              </button>
                            )}
                            {order.status === 'APPROVED' && (
                              <button className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors">
                                <Package size={12} /> Mark Received
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-[#64748B] text-sm">
                        No purchase orders match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════
          VENDORS TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'vendors' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              title="Total Vendors"
              value={totalVendors}
              icon={Building2}
              iconColor="text-[#0F6E56]"
              iconBg="bg-[#0F6E56]/10"
            />
            <StatCard
              title="Active Vendors"
              value={activeVendors}
              icon={CheckCircle}
              iconColor="text-emerald-400"
              iconBg="bg-emerald-500/10"
              change={`${Math.round((activeVendors / totalVendors) * 100)}% of total`}
              changeType="neutral"
            />
            <StatCard
              title="Total Orders Value"
              value={`$${(totalOrdersValue / 1000).toFixed(0)}k`}
              icon={DollarSign}
              iconColor="text-amber-400"
              iconBg="bg-amber-500/10"
              change="Lifetime purchases"
              changeType="neutral"
            />
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
            <input
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="Search vendors..."
              className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all"
            />
          </div>

          {/* Vendor Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredVendors.map((vendor) => {
              const vs = vendorStatusConfig[vendor.status]
              return (
                <div
                  key={vendor.id}
                  className="bg-white/50 border border-[#E2E8F0] rounded-2xl p-5 hover:border-slate-600/60 transition-colors"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#0F6E56]/10 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-[#0F6E56]" />
                      </div>
                      <div>
                        <p className="text-[#0F172A] font-semibold text-sm leading-tight">{vendor.name}</p>
                        <p className="text-[#64748B] text-xs mt-0.5">{vendor.contactPerson}</p>
                      </div>
                    </div>
                    <span
                      className={clsx(
                        'px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0',
                        vs.bg,
                        vs.color,
                      )}
                    >
                      {vs.label}
                    </span>
                  </div>

                  {/* Contact Details */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-xs text-[#64748B]">
                      <Mail size={12} className="text-slate-600 flex-shrink-0" />
                      <span className="truncate">{vendor.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#64748B]">
                      <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                      <span>
                        {vendor.city}, {vendor.country}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#64748B]">
                      <CreditCard size={12} className="text-slate-600 flex-shrink-0" />
                      <span>{vendor.paymentTerms}</span>
                    </div>
                  </div>

                  {/* Footer Stats */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#E2E8F0]">
                    <div className="text-center">
                      <p className="text-xs text-[#64748B]">Orders</p>
                      <p className="text-sm font-bold text-[#0F172A] mt-0.5">{vendor.totalOrders}</p>
                    </div>
                    <div className="w-px h-8 bg-[#F1F5F9]" />
                    <div className="text-center">
                      <p className="text-xs text-[#64748B]">Total Value</p>
                      <p className="text-sm font-bold text-[#0F6E56] mt-0.5">
                        ${(vendor.totalValue / 1000).toFixed(0)}k
                      </p>
                    </div>
                    <button className="flex items-center gap-1 text-xs text-[#64748B] hover:text-[#0F6E56] transition-colors px-3 py-1.5 rounded-lg hover:bg-[#0F6E56]/10">
                      <Eye size={12} /> View
                    </button>
                  </div>
                </div>
              )
            })}
            {filteredVendors.length === 0 && (
              <div className="col-span-3 py-16 text-center text-[#64748B] text-sm">
                No vendors match your search.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
