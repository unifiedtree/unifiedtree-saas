import React, { useState } from 'react'
import { Package, TrendingDown, AlertTriangle, BarChart2, Search, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'

interface InventoryItem {
  id: string
  sku: string
  name: string
  category: string
  quantity: number
  minStock: number
  unitPrice: number
  warehouse: string
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  lastUpdated: string
}

const MOCK_INVENTORY: InventoryItem[] = [
  { id: 'inv1', sku: 'LAP-PRO-001', name: 'MacBook Pro 14"', category: 'Laptops', quantity: 24, minStock: 10, unitPrice: 185000, warehouse: 'Mumbai WH1', status: 'IN_STOCK', lastUpdated: '2025-01-14' },
  { id: 'inv2', sku: 'LAP-PRO-002', name: 'Dell XPS 15', category: 'Laptops', quantity: 8, minStock: 10, unitPrice: 120000, warehouse: 'Mumbai WH1', status: 'LOW_STOCK', lastUpdated: '2025-01-12' },
  { id: 'inv3', sku: 'MON-UHD-001', name: 'LG 4K Monitor 27"', category: 'Monitors', quantity: 35, minStock: 15, unitPrice: 42000, warehouse: 'Delhi WH2', status: 'IN_STOCK', lastUpdated: '2025-01-13' },
  { id: 'inv4', sku: 'KEY-MECH-001', name: 'Keychron K2 Keyboard', category: 'Peripherals', quantity: 62, minStock: 20, unitPrice: 8500, warehouse: 'Mumbai WH1', status: 'IN_STOCK', lastUpdated: '2025-01-10' },
  { id: 'inv5', sku: 'MSE-LOG-001', name: 'Logitech MX Master 3', category: 'Peripherals', quantity: 3, minStock: 10, unitPrice: 7200, warehouse: 'Delhi WH2', status: 'LOW_STOCK', lastUpdated: '2025-01-15' },
  { id: 'inv6', sku: 'CAM-WEB-001', name: 'Logitech C920 Webcam', category: 'Accessories', quantity: 0, minStock: 5, unitPrice: 6800, warehouse: 'Bangalore WH3', status: 'OUT_OF_STOCK', lastUpdated: '2025-01-08' },
  { id: 'inv7', sku: 'PHN-IPH-001', name: 'iPhone 15 Pro', category: 'Phones', quantity: 12, minStock: 5, unitPrice: 130000, warehouse: 'Mumbai WH1', status: 'IN_STOCK', lastUpdated: '2025-01-11' },
  { id: 'inv8', sku: 'TAB-IPD-001', name: 'iPad Pro 11"', category: 'Tablets', quantity: 6, minStock: 8, unitPrice: 89000, warehouse: 'Delhi WH2', status: 'LOW_STOCK', lastUpdated: '2025-01-09' },
  { id: 'inv9', sku: 'HUB-USB-001', name: 'USB-C 7-Port Hub', category: 'Accessories', quantity: 48, minStock: 20, unitPrice: 3200, warehouse: 'Bangalore WH3', status: 'IN_STOCK', lastUpdated: '2025-01-15' },
  { id: 'inv10', sku: 'SRV-RCK-001', name: 'Dell PowerEdge R750', category: 'Servers', quantity: 2, minStock: 1, unitPrice: 850000, warehouse: 'Mumbai WH1', status: 'IN_STOCK', lastUpdated: '2025-01-05' },
  { id: 'inv11', sku: 'NET-SWT-001', name: 'Cisco Catalyst 2960', category: 'Networking', quantity: 0, minStock: 3, unitPrice: 45000, warehouse: 'Delhi WH2', status: 'OUT_OF_STOCK', lastUpdated: '2025-01-03' },
  { id: 'inv12', sku: 'CHR-ERG-001', name: 'Herman Miller Aeron', category: 'Furniture', quantity: 15, minStock: 5, unitPrice: 95000, warehouse: 'Bangalore WH3', status: 'IN_STOCK', lastUpdated: '2025-01-14' },
]

const statusConfig: Record<InventoryItem['status'], { label: string; color: string; bg: string }> = {
  IN_STOCK: { label: 'In Stock', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  LOW_STOCK: { label: 'Low Stock', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  OUT_OF_STOCK: { label: 'Out of Stock', color: 'text-red-400', bg: 'bg-red-500/10' },
}

export const InventoryDashboard: React.FC = () => {
  const [search, setSearch] = useState('')

  const inStock = MOCK_INVENTORY.filter((i) => i.status === 'IN_STOCK').length
  const lowStock = MOCK_INVENTORY.filter((i) => i.status === 'LOW_STOCK').length
  const outOfStock = MOCK_INVENTORY.filter((i) => i.status === 'OUT_OF_STOCK').length
  const totalValue = MOCK_INVENTORY.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  const filtered = MOCK_INVENTORY.filter((item) => {
    const q = search.toLowerCase()
    return !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Inventory</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_INVENTORY.length} SKUs across 3 warehouses</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} /> Add Item
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="In Stock" value={inStock} icon={Package} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Low Stock" value={lowStock} icon={AlertTriangle} iconColor="text-amber-400" iconBg="bg-amber-500/10" change="Reorder needed" changeType="negative" />
        <StatCard title="Out of Stock" value={outOfStock} icon={TrendingDown} iconColor="text-red-400" iconBg="bg-red-500/10" change="Action required" changeType="negative" />
        <StatCard title="Total Value" value={`₹${(totalValue / 10000000).toFixed(1)}Cr`} icon={BarChart2} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inventory..." className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['SKU', 'Item Name', 'Category', 'Quantity', 'Min Stock', 'Unit Price', 'Total Value', 'Warehouse', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const sc = statusConfig[item.status]
                const totalVal = item.quantity * item.unitPrice
                return (
                  <tr key={item.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3 text-[#0F6E56] font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3">
                      <p className="text-[#0F172A] font-medium">{item.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-white text-[#64748B] text-xs rounded-lg">{item.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('font-semibold', item.quantity === 0 ? 'text-red-400' : item.quantity <= item.minStock ? 'text-amber-400' : 'text-[#0F172A]')}>
                        {item.quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">{item.minStock}</td>
                    <td className="px-4 py-3 text-[#334155] whitespace-nowrap">₹{item.unitPrice.toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#334155] whitespace-nowrap">₹{(totalVal / 100000).toFixed(1)}L</td>
                    <td className="px-4 py-3 text-[#64748B]">{item.warehouse}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
