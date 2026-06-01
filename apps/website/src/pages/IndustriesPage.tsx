import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Factory, ShoppingBag, Truck, Utensils, Building2,
  Stethoscope, BookOpen, Wrench, ChevronRight,
} from 'lucide-react'
import { Navbar } from '../components/layout/Navbar'
import { Footer } from '../components/layout/Footer'
import { CTABanner } from '../components/home/CTABanner'

const industries = [
  {
    id: 'manufacturing',
    icon: Factory,
    name: 'Manufacturing',
    tagline: 'From BOM to dispatch — fully automated.',
    description:
      'UnifiedTree manages your entire manufacturing lifecycle: raw material procurement, Bill of Materials, work orders, quality checks, and finished goods inventory — all in one system.',
    useCases: [
      'Multi-level Bill of Materials with variants',
      'Work order creation and shop floor tracking',
      'MRP — automatic material requirements planning',
      'Quality control at each production stage',
      'Scrap and waste tracking',
      'Machine and workcenter scheduling',
    ],
    modules: ['Manufacturing', 'Inventory', 'Purchase', 'Accounting', 'HR & Employees'],
    testimonial: {
      quote: "Our production efficiency improved 28% in 3 months. BOM management alone saved us 40 hours per month of manual work.",
      name: 'Rajesh Agarwal',
      company: 'Agarwal Auto Parts, Pune',
    },
  },
  {
    id: 'retail',
    icon: ShoppingBag,
    name: 'Retail & Distribution',
    tagline: 'Never miss a sale — even offline.',
    description:
      'Run a single store or a chain of 50. UnifiedTree POS works offline, syncs inventory centrally, and gives you real-time sales visibility across all locations.',
    useCases: [
      'Offline POS — billing without internet',
      'Multi-store inventory management',
      'Customer loyalty points and discounts',
      'Daily sales reports and end-of-day',
      'Reorder alerts and purchase automation',
      'GST-compliant receipts and invoices',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'CRM', 'Reports & BI'],
    testimonial: {
      quote: "We have 8 stores across Maharashtra. UnifiedTree POS handles peak season billing flawlessly — even when the internet goes down.",
      name: 'Kiran Desai',
      company: 'Desai Retail Group',
    },
  },
  {
    id: 'trading',
    icon: Truck,
    name: 'Trading & Distribution',
    tagline: 'Buy right. Sell faster. Track everything.',
    description:
      'From vendor POs to customer delivery, UnifiedTree manages your entire trading operation. 3-way matching, batch tracking, and multi-location inventory built in.',
    useCases: [
      'Purchase order and vendor management',
      'Goods receipt and 3-way matching',
      'Multi-warehouse stock transfers',
      'Customer order fulfillment tracking',
      'Batch and serial number tracking',
      'GST e-way bill generation',
    ],
    modules: ['Purchase', 'Inventory', 'Sales', 'Accounting', 'CRM'],
    testimonial: {
      quote: "Stock reconciliation used to take 3 days every month. With UnifiedTree, it's live — always accurate, always updated.",
      name: 'Priya Shah',
      company: 'Shah Trading Co., Surat',
    },
  },
  {
    id: 'hospitality',
    icon: Utensils,
    name: 'Hospitality & Food',
    tagline: 'Fast billing. Happy tables. Zero chaos.',
    description:
      'Restaurant chains, cloud kitchens, and hotels use UnifiedTree POS for KOT management, table billing, and daily operations. Works seamlessly even during rush hours.',
    useCases: [
      'KOT (Kitchen Order Ticket) management',
      'Table and seat management',
      'Offline billing during connectivity issues',
      'Recipe and ingredient costing',
      'Daily cash register management',
      'Zomato and Swiggy order integration',
    ],
    modules: ['Point of Sale', 'Inventory', 'Accounting', 'HR & Employees', 'Payroll'],
    testimonial: {
      quote: "Our cloud kitchen runs on UnifiedTree. From ordering ingredients to billing — everything in one place. Game changer.",
      name: 'Ananya Mehta',
      company: 'Spice Route Kitchens, Bengaluru',
    },
  },
  {
    id: 'services',
    icon: Building2,
    name: 'Professional Services',
    tagline: 'Project-based billing. Streamlined.',
    description:
      'IT firms, consultancies, architects, and agencies use UnifiedTree to manage projects, track time, invoice clients, and run payroll — all connected.',
    useCases: [
      'Project milestones and task tracking',
      'Timesheet and billable hours',
      'Project-based invoicing',
      'Employee utilization dashboards',
      'Retainer and advance billing',
      'GST invoicing with TDS deduction',
    ],
    modules: ['Projects', 'Accounting', 'HR & Employees', 'Payroll', 'CRM'],
    testimonial: {
      quote: "Tracking billable hours across 12 projects was a nightmare. UnifiedTree Projects solved it in the first week.",
      name: 'Rohan Verma',
      company: 'Verma IT Solutions, Hyderabad',
    },
  },
  {
    id: 'healthcare',
    icon: Stethoscope,
    name: 'Healthcare & Pharma',
    tagline: 'Compliance-ready. Patient-safe.',
    description:
      'Hospitals, clinics, and pharma distributors rely on UnifiedTree for batch tracking, expiry management, compliance reporting, and staff management.',
    useCases: [
      'Batch and expiry date tracking',
      'Controlled substance tracking',
      'FIFO stock valuation for medicines',
      'Staff attendance and shift management',
      'Vendor compliance documentation',
      'Purchase of scheduled drugs tracking',
    ],
    modules: ['Inventory', 'Purchase', 'HR & Employees', 'Attendance', 'Accounting'],
    testimonial: {
      quote: "Expiry management for 3,000+ SKUs was a compliance risk. UnifiedTree's inventory solved it completely.",
      name: 'Dr. Pradeep Kumar',
      company: 'MediCure Distributors, Delhi',
    },
  },
  {
    id: 'education',
    icon: BookOpen,
    name: 'Education',
    tagline: 'Run your institution. Not your spreadsheets.',
    description:
      'Schools, colleges, and coaching institutes use UnifiedTree for staff payroll, attendance, fee management, and expense tracking.',
    useCases: [
      'Staff attendance and payroll',
      'PF, ESI for teaching and non-teaching staff',
      'Expense and budget management',
      'Vendor and supplier management',
      'Asset tracking across campuses',
      'Multi-branch consolidated reports',
    ],
    modules: ['HR & Employees', 'Attendance', 'Payroll', 'Accounting', 'Reports & BI'],
    testimonial: {
      quote: "We manage payroll for 280 staff across 6 campuses. UnifiedTree made it a one-click process.",
      name: 'Sunita Pillai',
      company: 'Pillai Group of Schools, Mumbai',
    },
  },
  {
    id: 'construction',
    icon: Wrench,
    name: 'Construction & Real Estate',
    tagline: 'Projects on time. Costs in control.',
    description:
      'Construction firms use UnifiedTree to manage labour attendance, material procurement, project budgets, and sub-contractor billing.',
    useCases: [
      'GPS-based labour attendance on site',
      'Material procurement and site stock',
      'Project-wise budget vs actuals',
      'Sub-contractor billing and PO management',
      'Equipment tracking',
      'Progress billing and retention management',
    ],
    modules: ['Attendance', 'Purchase', 'Inventory', 'Projects', 'Accounting'],
    testimonial: {
      quote: "GPS attendance at remote construction sites changed everything for us. No more proxy marking. Attendance is now 100% accurate.",
      name: 'Ramesh Joshi',
      company: 'Joshi Construction Pvt. Ltd.',
    },
  },
]

export function IndustriesPage() {
  const [selected, setSelected] = useState(industries[0].id)
  const active = industries.find((i) => i.id === selected)!

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-24 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="absolute glow-orb w-[500px] h-[500px] bg-accent top-[-200px] right-[-100px]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-6">
              Industries
            </span>
            <h1
              className="font-heading font-extrabold text-white mb-6"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em', lineHeight: 1.08 }}
            >
              One platform.
              <br />
              <span className="text-accent">Every industry.</span>
            </h1>
            <p className="text-lg text-white/75 font-body max-w-2xl mx-auto">
              UnifiedTree is trusted across 8 major industries. Same platform, purpose-built
              workflows for each sector.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Industry explorer */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-4 gap-8">
            {/* Sidebar list */}
            <div className="lg:col-span-1 space-y-2">
              {industries.map((ind) => {
                const Icon = ind.icon
                const isActive = ind.id === selected
                return (
                  <motion.button
                    key={ind.id}
                    onClick={() => setSelected(ind.id)}
                    whileHover={{ x: isActive ? 0 : 4 }}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 ${
                      isActive
                        ? 'bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/20'
                        : 'premium-card text-text-secondary hover:text-primary'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-white' : 'text-primary'} />
                    <span className="text-sm font-body font-medium">{ind.name}</span>
                    {isActive && <ChevronRight size={14} className="ml-auto" />}
                  </motion.button>
                )
              })}
            </div>

            {/* Detail panel */}
            <div className="lg:col-span-3">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.3 }}
                  className="premium-card p-9"
                >
                  <div className="flex items-start gap-4 mb-7">
                    <div className="icon-box w-14 h-14 flex-shrink-0">
                      <active.icon size={26} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="font-heading font-bold text-text-primary text-2xl">{active.name}</h2>
                      <p className="font-body font-semibold text-primary">{active.tagline}</p>
                    </div>
                  </div>

                  <p className="text-text-secondary font-body leading-relaxed mb-8">{active.description}</p>

                  <div className="grid md:grid-cols-2 gap-8 mb-8">
                    <div>
                      <h4 className="font-heading font-bold text-text-primary text-sm uppercase tracking-wider mb-4">
                        Key Use Cases
                      </h4>
                      <ul className="space-y-2.5">
                        {active.useCases.map((uc) => (
                          <li key={uc} className="flex items-start gap-2.5 text-sm text-text-secondary font-body">
                            <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-primary" />
                            {uc}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-heading font-bold text-text-primary text-sm uppercase tracking-wider mb-4">
                        Recommended Modules
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {active.modules.map((mod) => (
                          <span
                            key={mod}
                            className="px-3.5 py-1.5 rounded-full text-xs font-body font-semibold border border-primary/20 text-primary bg-primary-light"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>

                      {/* Testimonial */}
                      <div className="mt-7 p-5 rounded-xl border border-border relative"
                        style={{ background: 'linear-gradient(135deg, rgba(15,110,86,0.04), rgba(29,185,133,0.02))' }}
                      >
                        <span className="absolute top-3 right-4 text-3xl text-primary/10 font-heading font-bold leading-none select-none">"</span>
                        <p className="text-sm text-text-secondary font-body leading-relaxed mb-3 relative z-10">
                          "{active.testimonial.quote}"
                        </p>
                        <p className="text-xs font-heading font-semibold text-text-primary">{active.testimonial.name}</p>
                        <p className="text-xs text-text-secondary font-body">{active.testimonial.company}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      <CTABanner />
      <Footer />
    </div>
  )
}
