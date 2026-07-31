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
  Present: 'bg-lime/20 text-lime',
  Absent: 'bg-danger/20 text-red-300',
  'On Leave': 'bg-warning/20 text-amber-300',
}

const sidebarItems = ['Dashboard', 'HR', 'Attendance', 'Accounting', 'Inventory', 'CRM']
const avatarColors = ['#18280E', '#3A5A25', '#5B8C2A', '#274012', '#7CA83E']

export function HeroSection() {
  const navigate = useNavigate()

  return (
    <section className="min-h-screen bg-[#EBF5DF] flex flex-col items-center justify-center pt-32 pb-12 relative overflow-hidden">
      {/* Full-width bright white squircle background pattern */}
      <div className="absolute inset-0 bg-squircle-grid-white pointer-events-none" />
      {/* Fading gradient to hide the pattern at the bottom */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#EBF5DF]/80 to-[#EBF5DF] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex flex-col items-center text-center relative z-10">
        {/* Eyebrow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="inline-flex items-center gap-2 text-[#18280E]/60 text-sm font-mono mb-6"
        >
          <span className="text-[#84cc16]">•</span>
          Meet the leading
        </motion.div>

        {/* H1 */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="font-heading font-medium tracking-tight text-[#18280E] mb-6"
          style={{ fontSize: 'clamp(3.5rem, 8vw, 6.5rem)', lineHeight: 1.1 }}
        >
          One Platform <br />
          Unlimited Potential
        </motion.h1>

        {/* Subheadline */}
        <motion.p
           initial={{ opacity: 0, y: 30 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
           className="text-lg text-[#18280E]/70 font-body leading-relaxed mb-10 max-w-2xl mx-auto px-4"
        >
          UnifiedTree's platform of software and services lays the<br className="hidden sm:block" />
          groundwork so you can focus on building the future.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
          className="flex flex-wrap justify-center gap-4 mb-20"
        >
          <Button size="lg" className="bg-[#18280E] text-white hover:bg-[#2A4718] border-none font-semibold rounded-xl px-8 shadow-md" onClick={() => navigate('/talk-to-us?intent=demo')}>
            Request a demo
          </Button>
          <Button size="lg" className="bg-white border border-[#E6EBDD] text-[#18280E] hover:bg-slate-50 rounded-xl px-8 transition-colors shadow-sm" variant="ghost" onClick={() => navigate('/talk-to-us?intent=sales')}>
            Contact sales
          </Button>
        </motion.div>

        {/* Dashboard mockup (centered and overlapping bottom) */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: 'easeOut' }}
          className="w-full max-w-5xl mx-auto px-4 sm:px-8 translate-y-8"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="bg-[#0F1B08] rounded-t-2xl shadow-2xl overflow-hidden border-t border-l border-r border-[#18280E]/10 w-full text-left"
          >
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5">
              <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
              <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
              <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
              <span className="ml-3 text-xs text-slate-400 font-mono flex items-center gap-2">
                <img src="/UnifiedTreeLogo.png" alt="UnifiedTree" className="h-4 w-auto brightness-0 invert opacity-70" />
              </span>
            </div>

            <div className="flex bg-[#0A1205]">
              {/* Sidebar */}
              <div className="w-40 border-r border-white/10 p-4 flex-shrink-0 hidden md:block">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Main Menu</div>
                {sidebarItems.map((item, i) => (
                  <div
                    key={item}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${
                      i === 0
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>

              {/* Main content */}
              <div className="flex-1 p-6 min-w-0 bg-[#0F1B08]">
                <div className="flex items-center justify-between mb-6">
                   <h2 className="text-xl font-semibold text-white">Dashboard</h2>
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-white/10" />
                     <div className="w-8 h-8 rounded-full bg-white/10" />
                     <div className="w-8 h-8 rounded-full bg-white/10" />
                   </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {/* KPI cards - Left Side */}
                  <div className="col-span-1 lg:col-span-1 space-y-5">
                    <div className="bg-[#1C2C16] rounded-xl p-5 border border-white/5 shadow-sm">
                      <p className="text-sm text-slate-300 font-medium mb-2">Revenue being processed</p>
                      <p className="text-3xl font-heading font-semibold text-white mb-1">₹24,60,000</p>
                      <p className="text-xs text-lime">Last 1 month period</p>
                    </div>
                    <div className="bg-[#18280E]/50 rounded-xl p-5 border border-white/5 shadow-sm">
                      <p className="text-sm text-slate-300 font-medium mb-2">Platform fees</p>
                      <p className="text-2xl font-heading font-semibold text-white mb-1">₹12,450</p>
                      <p className="text-xs text-slate-400">Last 1 month period</p>
                    </div>
                  </div>
                  
                  {/* Chart - Right Side */}
                  <div className="col-span-1 lg:col-span-2 bg-[#F9F9F9] rounded-xl p-5 border border-white/10 text-slate-900 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                      <p className="text-sm font-semibold text-slate-700">Your rewards</p>
                      <div className="flex gap-2 text-xs font-medium text-slate-500">
                         <span className="px-2 py-1 rounded-md hover:bg-slate-200 cursor-pointer">1d</span>
                         <span className="px-2 py-1 rounded-md hover:bg-slate-200 cursor-pointer">1w</span>
                         <span className="px-2 py-1 rounded-md bg-white shadow-sm text-slate-900 cursor-pointer">1m</span>
                         <span className="px-2 py-1 rounded-md hover:bg-slate-200 cursor-pointer">1y</span>
                         <span className="px-2 py-1 rounded-md hover:bg-slate-200 cursor-pointer">All</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-8 h-40">
                       {/* Donut Chart Mockup */}
                       <div className="relative w-32 h-32 rounded-full border-[12px] border-[#1C2C16] border-t-[#A3E635] border-r-[#FF9F1C] border-b-[#FF9F1C] flex items-center justify-center">
                          <div className="text-center">
                            <div className="text-lg font-bold text-slate-900">₹271,783</div>
                            <div className="text-[10px] text-slate-500">Total rewards</div>
                          </div>
                       </div>
                       <div className="flex flex-col gap-3">
                         <div className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                           <div className="w-2.5 h-2.5 rounded-sm bg-[#1C2C16]" /> Benefits offered
                         </div>
                         <div className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                           <div className="w-2.5 h-2.5 rounded-sm bg-[#FF9F1C]" /> Target variable pay
                         </div>
                         <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-sm bg-[#FFBD2E]" />
                           <div className="w-16 h-2 bg-slate-200 rounded-full" />
                         </div>
                         <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-sm bg-[#A3E635]" />
                           <div className="w-16 h-2 bg-slate-200 rounded-full" />
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
