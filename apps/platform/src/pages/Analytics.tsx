import React, { useState } from 'react'
import { TrendingUp, DollarSign, Users, ShoppingCart, BarChart2, Activity } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { StatCard } from '@/shared/components/StatCard'

const revenueData = [
  { month: 'Jan', revenue: 285000, target: 270000 },
  { month: 'Feb', revenue: 312000, target: 290000 },
  { month: 'Mar', revenue: 298000, target: 300000 },
  { month: 'Apr', revenue: 345000, target: 315000 },
  { month: 'May', revenue: 380000, target: 340000 },
  { month: 'Jun', revenue: 402000, target: 370000 },
  { month: 'Jul', revenue: 375000, target: 390000 },
  { month: 'Aug', revenue: 428000, target: 400000 },
  { month: 'Sep', revenue: 456000, target: 420000 },
  { month: 'Oct', revenue: 489000, target: 450000 },
  { month: 'Nov', revenue: 512000, target: 470000 },
  { month: 'Dec', revenue: 548000, target: 500000 },
]

const moduleUsage = [
  { name: 'HRMS', users: 142, sessions: 890 },
  { name: 'CRM', users: 87, sessions: 654 },
  { name: 'Accounts', users: 64, sessions: 421 },
  { name: 'Projects', users: 53, sessions: 387 },
  { name: 'Helpdesk', users: 38, sessions: 298 },
  { name: 'Inventory', users: 29, sessions: 187 },
]

const signupTrend = [
  { week: 'W1', users: 12 }, { week: 'W2', users: 18 }, { week: 'W3', users: 14 },
  { week: 'W4', users: 24 }, { week: 'W5', users: 31 }, { week: 'W6', users: 28 },
  { week: 'W7', users: 36 }, { week: 'W8', users: 42 }, { week: 'W9', users: 38 },
  { week: 'W10', users: 47 }, { week: 'W11', users: 53 }, { week: 'W12', users: 61 },
]

const planDistribution = [
  { name: 'Starter', value: 2840, color: '#64748b' },
  { name: 'Professional', value: 5620, color: '#6366f1' },
  { name: 'Enterprise', value: 1540, color: '#a855f7' },
]

const RADIAN = Math.PI / 180
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) => {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

const periods = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 12 months']

export const Analytics: React.FC = () => {
  const [period, setPeriod] = useState('Last 12 months')

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Analytics</h1>
          <p className="text-[#64748B] text-sm mt-0.5">Platform-wide metrics and insights</p>
        </div>
        <div className="flex gap-1 bg-white border border-[#E2E8F0]/40 rounded-xl p-1">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p ? 'bg-indigo-600 text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard title="Total Revenue" value="$4.41M" change="+22.4% YoY" changeType="positive" icon={DollarSign} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" subtitle="FY 2024" />
        <StatCard title="Active Users" value="9,847" change="+18.2% growth" changeType="positive" icon={Users} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" subtitle="Across all tenants" />
        <StatCard title="MRR" value="$548K" change="+7.1% MoM" changeType="positive" icon={TrendingUp} iconColor="text-purple-400" iconBg="bg-purple-500/10" subtitle="Monthly recurring revenue" />
        <StatCard title="Avg Session" value="18.4 min" change="+2.1 min" changeType="positive" icon={Activity} iconColor="text-blue-400" iconBg="bg-blue-500/10" subtitle="Per active user" />
        <StatCard title="Total Transactions" value="28,492" change="+31.5% growth" changeType="positive" icon={ShoppingCart} iconColor="text-amber-400" iconBg="bg-amber-500/10" subtitle="This year" />
        <StatCard title="Module Activations" value="1,247" change="+48 this month" changeType="positive" icon={BarChart2} iconColor="text-rose-400" iconBg="bg-rose-500/10" subtitle="Across all orgs" />
      </div>

      {/* Revenue Chart */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-[#0F172A] font-semibold text-sm">Revenue vs Target</h3>
            <p className="text-[#64748B] text-xs mt-0.5">Monthly breakdown — 2024</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-[#64748B]"><span className="w-3 h-0.5 bg-indigo-500 rounded" />Actual</span>
            <span className="flex items-center gap-1.5 text-[#64748B]"><span className="w-3 h-0.5 bg-slate-600 rounded border-dashed border" />Target</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={revenueData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="revGradA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 12, color: '#f1f5f9', fontSize: 12 }}
              formatter={(v: number, name: string) => [`$${(v / 1000).toFixed(0)}k`, name]}
            />
            <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revGradA)" name="Actual Revenue" />
            <Line type="monotone" dataKey="target" stroke="#475569" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Target" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Module Usage */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="text-[#0F172A] font-semibold text-sm">Module Usage</h3>
            <p className="text-[#64748B] text-xs mt-0.5">Users & sessions per module</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={moduleUsage} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 12, color: '#f1f5f9', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
              <Bar dataKey="users" fill="#6366f1" radius={[4, 4, 0, 0]} name="Active Users" />
              <Bar dataKey="sessions" fill="#a855f7" radius={[4, 4, 0, 0]} name="Sessions" opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* New Signups Trend */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="text-[#0F172A] font-semibold text-sm">New User Signups</h3>
            <p className="text-[#64748B] text-xs mt-0.5">Weekly trend — last 12 weeks</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={signupTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 12, color: '#f1f5f9', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="users" stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981', r: 3 }} name="New Users" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plan Distribution */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-[#0F172A] font-semibold text-sm">Plan Distribution</h3>
            <p className="text-[#64748B] text-xs mt-0.5">Tenants by subscription tier</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-[#0F172A]">10,000</p>
            <p className="text-xs text-[#64748B]">Total tenants</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={planDistribution}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
              >
                {planDistribution.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 12, color: '#f1f5f9', fontSize: 12 }}
                formatter={(v: number) => [v.toLocaleString(), 'Tenants']}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-4">
            {planDistribution.map((plan) => (
              <div key={plan.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: plan.color }} />
                  <span className="text-[#334155] text-sm">{plan.name}</span>
                </div>
                <div className="text-right">
                  <p className="text-[#0F172A] font-semibold text-sm">{plan.value.toLocaleString()}</p>
                  <p className="text-slate-600 text-xs">{((plan.value / 10000) * 100).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
