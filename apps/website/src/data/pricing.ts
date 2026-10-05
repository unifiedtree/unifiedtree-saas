export interface EmployeeTier {
  min: number
  max: number | null
  multiplier: number | 'contact'
  label: string
}

export const employeeTiers: EmployeeTier[] = [
  { min: 1,   max: 10,   multiplier: 1.0,       label: '1–10' },
  { min: 11,  max: 25,   multiplier: 1.4,       label: '11–25' },
  { min: 26,  max: 50,   multiplier: 1.8,       label: '26–50' },
  { min: 51,  max: 100,  multiplier: 2.4,       label: '51–100' },
  { min: 101, max: 250,  multiplier: 3.2,       label: '101–250' },
  { min: 251, max: 500,  multiplier: 4.5,       label: '251–500' },
  { min: 501, max: null, multiplier: 'contact', label: '500+' },
]

export const sliderSnapPoints = [10, 25, 50, 100, 250, 500, 1000]

export function getMultiplier(employeeCount: number): number | 'contact' {
  const tier = employeeTiers.find(
    (t) => employeeCount >= t.min && (t.max === null || employeeCount <= t.max)
  )
  return tier?.multiplier ?? 1.0
}

export const presetPlans = [
  {
    id: 'starter',
    name: 'Starter',
    price: 2499,
    description: 'Perfect for small teams getting started',
    users: 'Up to 10 users',
    modules: ['HR & Employees', 'Attendance', 'Accounting'],
    storage: '5 GB storage',
    support: 'Email support',
    extras: ['Offline PWA attendance', 'Tax invoicing', 'Basic reports'],
    popular: false,
    cta: 'Create Free Workspace',
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 7499,
    description: 'For scaling businesses that need everything',
    users: 'Up to 50 users',
    modules: ['All 12 modules'],
    storage: '50 GB storage',
    support: 'Priority support + live chat',
    extras: [
      'Live location tracking',
      'API access',
      'Tax e-filing integration (India: GSTR-1/3B)',
      'Custom dashboards',
      'WhatsApp notifications',
    ],
    popular: true,
    cta: 'Create Free Workspace',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    description: 'Custom solution for large organizations',
    users: 'Unlimited users',
    modules: ['Custom modules'],
    storage: 'Dedicated storage',
    support: 'Dedicated account manager',
    extras: [
      'SLA guarantee (99.5%)',
      'White-label option',
      'Custom integrations',
      'On-premise deployment option',
      'Security audit & compliance',
    ],
    popular: false,
    cta: 'Create Free Workspace',
  },
]

export const faqItems = [
  {
    q: 'How is HRMS priced?',
    a: 'Per user, per company. HRMS is one package — HR, Attendance, Leave and Payroll — and each company has its own subscription and invoice. Pay monthly or yearly through autopay.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes, 7 days. Creating your business is free; you start the trial by setting up autopay (card, UPI or bank) through Razorpay. Nothing is charged during the trial. Billing starts on day 8 and then renews on the same date each cycle (for example, 6 Oct – 6 Nov).',
  },
  {
    q: 'How is the employee count calculated?',
    a: 'Employee count is the number of active employees managed in the system, not the number of user logins. You can have fewer admin users than total employees.',
  },
  {
    q: 'Do I need a card to sign up?',
    a: 'Not to create your business — sign-up is self-service with no approval step. To use HRMS you set up autopay, which starts the 7-day free trial. Cancel before day 8 and you are not charged.',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). The platform runs on Google Cloud (asia-south1) with automated daily backups (24-hour recovery point).',
  },
  {
    q: 'Can I use UnifiedTree offline?',
    a: 'The Attendance and POS modules are fully offline-capable (PWA). Data syncs automatically when connectivity is restored.',
  },
  {
    q: 'Do you support local tax e-filing?',
    a: 'Yes. Region compliance packs ship with the Accounting module. The India pack supports GSTR-1, GSTR-3B, and e-way bill generation with direct GST portal integration; other regions are on the roadmap.',
  },
  {
    q: 'What happens after signup?',
    a: 'Your business, its first company and your admin login are created right away. Set up autopay inside your business to start the 7-day trial; you can add more companies later.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Monthly plans are non-refundable once a cycle starts; annual plans cancelled within the first 30 days get a pro-rata refund. See the Refund & Cancellation Policy for details.',
  },
]
