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
    extras: ['Offline PWA attendance', 'GST invoicing', 'Basic reports'],
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
      'GST e-filing integration',
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
      'SLA guarantee (99.9%)',
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
    q: 'Can I change my plan at any time?',
    a: 'Yes. Plans are shown for pricing guidance, and your free workspace can be upgraded later without rebuilding company data.',
  },
  {
    q: 'Is workspace creation free?',
    a: 'Yes. Company workspace creation is free, no credit card is required, and the workspace activates immediately after signup.',
  },
  {
    q: 'How is the employee count calculated?',
    a: 'Employee count is the number of active employees managed in the system, not the number of user logins. You can have fewer admin users than total employees.',
  },
  {
    q: 'Do I need to pay during signup?',
    a: 'No. The current signup flow does not collect payment or submit an approval request to UnifiedTree administrators.',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We\'re hosted on AWS with automatic backups every 6 hours.',
  },
  {
    q: 'Can I use UnifiedTree offline?',
    a: 'The Attendance and POS modules are fully offline-capable (PWA). Data syncs automatically when connectivity is restored.',
  },
  {
    q: 'Do you support GST e-filing?',
    a: 'Yes. The Accounting module supports GSTR-1, GSTR-3B, and e-way bill generation, with direct GST portal integration.',
  },
  {
    q: 'What happens after signup?',
    a: 'Your tenant, company domain, admin login, and selected modules are created right away so you can start using the platform.',
  },
]
