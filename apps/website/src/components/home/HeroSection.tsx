import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Play } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from '../ui/Button'
import { AnimatedTagline } from '../ui/AnimatedTagline'

const revenueData = [
  { month: 'Jul', revenue: 14.2 },
  { month: 'Aug', revenue: 16.8 },
  { month: 'Sep', revenue: 15.1 },
  { month: 'Oct', revenue: 18.4 },
  { month: 'Nov', revenue: 21.3 },
  { month: 'Dec', revenue: 19.7 },
  { month: 'Jan', revenue: 22.9 },
  { month: 'Feb', revenue: 24.6 },
]

const attendanceRows = [
  { name: 'Priya Sharma', status: 'Present', time: '09:02 AM' },
  { name: 'Arjun Mehta', status: 'Present', time: '08:58 AM' },
  { name: 'Kavya Nair', status: 'On Leave', time: '—' },
  { name: 'Rohit Gupta', status: 'Absent', time: '—' },
]

const statusColors: Record<string, string> = {
  Present: 'bg-success/20 text-success',
  Absent: 'bg-danger/20 text-danger',
  'On Leave': 'bg-warning/20 text-warning',
}

const sidebarItems = ['Dashboard', 'HR', 'Attendance', 'Accounting', 'Inventory', 'CRM']
const avatarColors = ['#0F6E56', '#22C55E', '#0A5240', '#16A34A', '#4ADE80']

export function HeroSection() {
  const navigate = useNavigate()

  return (
    <section className="min-h-screen bg-bg flex items-center pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">

          {/* LEFT — text (z-index ensures it stays on top) */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="relative z-10"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary text-primary text-sm font-body font-medium mb-6 bg-primary-light"
            >
              <span className="text-base">🌱</span>
              India's First Offline-First ERP
            </motion.div>

            {/* H1 */}
            <h1
              className="font-heading font-extrabold text-text-primary mb-4"
              style={{ fontSize: 'clamp(2.8rem, 5vw, 4.5rem)', lineHeight: 1.1 }}
            >
              Run Your Entire Business
            </h1>

            {/* Animated tagline */}
            <div className="mb-6">
              <AnimatedTagline />
            </div>

            {/* Subheadline */}
            <p className="text-lg text-text-secondary font-body leading-relaxed mb-8 max-w-lg">
              UnifiedTree connects every department — HR, Finance, Sales, Inventory, and more —
              through one living, breathing platform. Works even when you're offline.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-4 mb-10">
              <Button size="lg" onClick={() => navigate('/pricing')}>
                Start Free Trial <ArrowRight size={18} />
              </Button>
              <Button size="lg" variant="ghost">
                <Play size={18} /> Watch Demo
              </Button>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-3">
              <div className="flex -space-x-3">
                {avatarColors.map((color, i) => (
                  <div
                    key={i}
                    className="w-9 h-9 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: color, zIndex: avatarColors.length - i }}
                  >
                    {['P', 'A', 'R', 'K', 'S'][i]}
                  </div>
                ))}
              </div>
              <p className="text-sm text-text-secondary font-body">
                Trusted by <span className="font-semibold text-text-primary">2,400+</span> businesses across India
              </p>
            </div>
          </motion.div>

          {/* RIGHT — dashboard mockup, strictly contained in its grid cell */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25, ease: 'easeOut' }}
            className="relative w-full"
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              whileHover={{ y: 0, scale: 1.01 }}
              className="bg-[#0F172A] rounded-2xl shadow-2xl overflow-hidden border border-white/10 w-full"
            >
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
                <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
                <span className="ml-3 text-xs text-slate-500 font-mono">app.unifiedtree.com</span>
              </div>

              <div className="flex">
                {/* Sidebar */}
                <div className="w-32 border-r border-white/10 p-3 flex-shrink-0">
                  {sidebarItems.map((item, i) => (
                    <div
                      key={item}
                      className={`px-3 py-2 rounded-lg text-xs font-mono mb-1 ${
                        i === 0
                          ? 'bg-primary text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>

                {/* Main content */}
                <div className="flex-1 p-4 min-w-0">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-xs text-slate-400 font-mono mb-1">Revenue</p>
                      <p className="text-lg font-heading font-bold text-white">₹24.6L</p>
                      <p className="text-xs text-success">+12.4% ↑</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-xs text-slate-400 font-mono mb-1">Employees</p>
                      <p className="text-lg font-heading font-bold text-white">142</p>
                      <p className="text-xs text-success">+3 this month</p>
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10 mb-4">
                    <p className="text-xs text-slate-400 font-mono mb-2">Revenue Trend</p>
                    <ResponsiveContainer width="100%" height={75}>
                      <AreaChart data={revenueData}>
                        <defs>
                          <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0F6E56" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="#0F6E56" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="month" tick={{ fontSize: 8, fill: '#64748B' }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip
                          contentStyle={{ background: '#1E293B', border: 'none', borderRadius: 8, fontSize: 10 }}
                          labelStyle={{ color: '#94A3B8' }}
                          itemStyle={{ color: '#22C55E' }}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#0F6E56" strokeWidth={2} fill="url(#heroGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Attendance table */}
                  <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/10">
                      <p className="text-xs text-slate-400 font-mono">Today's Attendance</p>
                    </div>
                    {attendanceRows.map((row) => (
                      <div key={row.name} className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-0">
                        <span className="text-xs text-slate-300 font-mono truncate">{row.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColors[row.status]}`}>
                          {row.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
