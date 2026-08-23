import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts'
import {
  Home, Users, Clock, CreditCard, DollarSign, Package, TrendingUp,
  FileBarChart2, Settings, Bell, Search, ChevronDown, ArrowUpRight,
  ArrowDownRight, CheckCircle2, AlertTriangle, AlertCircle, Clock3,
  CircleDot, Command, Download, SlidersHorizontal, type LucideIcon,
} from 'lucide-react'
import { clsx } from 'clsx'
import { HrTabs, HrTabPanel } from '@/shared/components/hr'

/**
 * ModuleWorkspace — a self-contained showcase of the module-workspace shell:
 * a dark emerald icon rail, a sticky top bar, and a sub-tab row whose panels
 * swap IN PLACE (no route change) with a direction-aware slide.
 *
 * Everything here is presentational. The data below is dummy content the
 * client replaces later — there are no API calls, no stores and no business
 * logic, so this page can be restyled freely without touching the product.
 *
 * ── Chart colour policy ────────────────────────────────────────────────────
 * The brand ramp is a SINGLE hue, so it is used the way a one-hue ramp is meant
 * to be used: ordinal steps for composition/stacks, and a lone slot-1 hue for
 * nominal bar comparisons (never colour-by-value). Where two steps must sit
 * side by side they always SKIP a step — consecutive steps (#10B981 ↔ #34D399)
 * are indistinguishable (ΔE 7.7, below the ΔE 15 normal-vision floor). The
 * pairs used below were validated for CVD separation in both themes:
 *   stack   #04503A · #059669 · #34D399            → worst adjacent ΔE 17.9
 *   donut   #04503A · #10B981 · #A7F3D0 · #FBBF24  → worst all-pairs  ΔE 18.6
 *   area    #047857 · #34D399                      → worst adjacent ΔE 21.2
 * Amber #FBBF24 is the single contrast accent. The light steps fall under 3:1
 * on white, so every chart ships the required relief: a legend carrying visible
 * values, direct labels, and a table view of the same numbers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Chart palette — CSS custom properties so the ramp re-steps for the dark theme
// rather than being flipped automatically. Dark steps were selected + validated
// against the dark surface (#141414) independently of the light ones.
// ─────────────────────────────────────────────────────────────────────────────
const CHART_TOKENS = `
.mw-scope {
  --mw-stack-1: #04503A; --mw-stack-2: #059669; --mw-stack-3: #34D399;
  --mw-part-1: #04503A; --mw-part-2: #10B981; --mw-part-3: #A7F3D0; --mw-part-4: #FBBF24;
  --mw-area-1: #047857; --mw-area-2: #34D399;
  /* Ordinal ramp — the full brand ramp in monotone lightness order, dark→light,
     so an ordered category (funnel stage, tier) shows its order in the colour. */
  --mw-ord-1: #04503A; --mw-ord-2: #047857; --mw-ord-3: #059669;
  --mw-ord-4: #10B981; --mw-ord-5: #34D399; --mw-ord-6: #A7F3D0;
  --mw-solo: #059669;
  --mw-accent: #FBBF24;
  --mw-grid: #E5E5E5;
  --mw-axis: #737373;
  --mw-plot: #FFFFFF;
}
[data-theme='dark'] .mw-scope {
  --mw-stack-1: #047857; --mw-stack-2: #10B981; --mw-stack-3: #A7F3D0;
  --mw-part-1: #047857; --mw-part-2: #10B981; --mw-part-3: #A7F3D0; --mw-part-4: #FBBF24;
  --mw-area-1: #047857; --mw-area-2: #34D399;
  /* Reversed for dark: the ramp still runs light→dark visually, but starts at the
     end that stays legible on a #141414 surface. */
  --mw-ord-1: #A7F3D0; --mw-ord-2: #34D399; --mw-ord-3: #10B981;
  --mw-ord-4: #059669; --mw-ord-5: #047857; --mw-ord-6: #04503A;
  --mw-solo: #10B981;
  --mw-accent: #FBBF24;
  --mw-grid: #292929;
  --mw-axis: #A3A3A3;
  --mw-plot: #141414;
}
`

const STACK_COLORS = ['var(--mw-stack-1)', 'var(--mw-stack-2)', 'var(--mw-stack-3)'] as const
const PART_COLORS = ['var(--mw-part-1)', 'var(--mw-part-2)', 'var(--mw-part-3)', 'var(--mw-part-4)'] as const
const AREA_COLORS = ['var(--mw-area-1)', 'var(--mw-area-2)'] as const
const ORDINAL_COLORS = [
  'var(--mw-ord-1)', 'var(--mw-ord-2)', 'var(--mw-ord-3)',
  'var(--mw-ord-4)', 'var(--mw-ord-5)', 'var(--mw-ord-6)',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────
const nf = (n: number) => n.toLocaleString('en-IN')
const cr = (n: number) => `₹${n.toFixed(2)} Cr`
const lakh = (n: number) => `₹${nf(n)} L`
const pct = (n: number) => `${n}%`
const units = (n: number) => `${nf(n)} u`

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type StatusKey = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
type LayoutKind = 'overview' | 'trend' | 'list' | 'split' | 'grid'

interface Kpi {
  label: string
  value: string
  sub: string
  delta: string
  dir: 'up' | 'down'
  good: boolean
}

interface AreaSpec {
  title: string
  blurb: string
  series: [string, string]
  fmt: (n: number) => string
  data: Array<{ x: string; a: number; b: number }>
}

interface BarSpec {
  title: string
  blurb: string
  measure: string
  fmt: (n: number) => string
  /** Ordinal categories (funnel stages, tiers) take the one-hue ramp; nominal ones do not. */
  ordinal?: boolean
  data: Array<{ x: string; v: number }>
}

interface StackSpec {
  title: string
  blurb: string
  keys: [string, string, string]
  fmt: (n: number) => string
  data: Array<{ x: string; a: number; b: number; c: number }>
}

interface DonutSpec {
  title: string
  blurb: string
  totalLabel: string
  fmt: (n: number) => string
  data: Array<{ name: string; value: number }>
}

interface TableSpec {
  title: string
  blurb: string
  columns: [string, string, string]
  rows: Array<{ id: string; title: string; meta: string; value: string; status: StatusKey; statusLabel: string }>
}

interface ModuleData {
  kpis: [Kpi, Kpi, Kpi, Kpi]
  area: AreaSpec
  bar: BarSpec
  stack: StackSpec
  donut: DonutSpec
  table: TableSpec
}

interface SubTab { key: string; label: string; layout: LayoutKind; blurb: string }

interface ModuleDef {
  key: string
  label: string
  icon: LucideIcon
  title: string
  tabs: SubTab[]
  data: ModuleData
}

// ─────────────────────────────────────────────────────────────────────────────
// Dummy data — realistic placeholder content; the client replaces the copy.
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const WEEKS = ['W-05', 'W-04', 'W-03', 'W-02', 'W-01', 'This wk']

const mkArea = (a: number[], b: number[]) => MONTHS.map((x, i) => ({ x, a: a[i], b: b[i] }))
const mkStack = (a: number[], b: number[], c: number[]) => WEEKS.map((x, i) => ({ x, a: a[i], b: b[i], c: c[i] }))

const MODULES: ModuleDef[] = [
  // ── Home ──────────────────────────────────────────────────────────────────
  {
    key: 'home',
    label: 'Home',
    icon: Home,
    title: 'Workspace home',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Everything happening across Acme Manufacturing this month.' },
      { key: 'activity', label: 'Activity', layout: 'list', blurb: 'A live feed of what your team changed, approved and published.' },
      { key: 'approvals', label: 'Approvals', layout: 'split', blurb: 'Requests waiting on you, grouped by how long they have been open.' },
      { key: 'adoption', label: 'Adoption', layout: 'trend', blurb: 'How each module is being picked up across departments.' },
      { key: 'licences', label: 'Licences', layout: 'grid', blurb: 'Seat allocation, utilisation and renewal exposure.' },
    ],
    data: {
      kpis: [
        { label: 'Active employees', value: '1,284', sub: 'across 6 branches', delta: '3.2%', dir: 'up', good: true },
        { label: 'Open approvals', value: '37', sub: '9 older than 3 days', delta: '12.0%', dir: 'down', good: true },
        { label: 'Seat utilisation', value: '87.4%', sub: '1,340 of 1,533 seats', delta: '1.8%', dir: 'up', good: true },
        { label: 'Monthly run cost', value: '₹4.82 Cr', sub: 'payroll + operations', delta: '2.4%', dir: 'up', good: false },
      ],
      area: {
        title: 'Workspace activity',
        blurb: 'Sessions and recorded actions, trailing twelve months.',
        series: ['Sessions', 'Actions'],
        fmt: nf,
        data: mkArea(
          [8420, 8910, 9240, 9680, 10120, 10480, 11240, 11890, 12360, 12980, 13420, 14180],
          [3210, 3480, 3620, 3910, 4180, 4340, 4720, 5010, 5240, 5580, 5810, 6240],
        ),
      },
      bar: {
        title: 'Adoption by module',
        blurb: 'Distinct users who opened each module in the last 30 days.',
        measure: 'Active users',
        fmt: nf,
        data: [
          { x: 'People', v: 1204 }, { x: 'Attendance', v: 1148 }, { x: 'Payroll', v: 386 },
          { x: 'Finance', v: 214 }, { x: 'Inventory', v: 178 }, { x: 'CRM', v: 142 },
          { x: 'Reports', v: 96 },
        ],
      },
      stack: {
        title: 'Approvals by stage',
        blurb: 'Where requests are sitting, week by week.',
        keys: ['Pending', 'In review', 'Cleared'],
        fmt: nf,
        data: mkStack([64, 58, 71, 49, 43, 37], [92, 88, 96, 84, 79, 74], [318, 342, 361, 388, 402, 412]),
      },
      donut: {
        title: 'Licence allocation',
        blurb: 'How the 1,533 purchased seats are assigned today.',
        totalLabel: 'Seats',
        fmt: nf,
        data: [
          { name: 'Full access', value: 486 }, { name: 'Self-service', value: 742 },
          { name: 'Manager', value: 112 }, { name: 'Unassigned', value: 193 },
        ],
      },
      table: {
        title: 'Needs your attention',
        blurb: 'Items assigned to you or blocked on your workspace.',
        columns: ['Item', 'Owner', 'Age'],
        rows: [
          { id: 'a1', title: 'March payroll sign-off', meta: 'Finance · Priya Nair', value: '2 days', status: 'warning', statusLabel: 'Due soon' },
          { id: 'a2', title: 'Q4 headcount plan review', meta: 'People · Rahul Menon', value: '5 days', status: 'danger', statusLabel: 'Overdue' },
          { id: 'a3', title: 'Vendor GST details refresh', meta: 'Finance · Anita Rao', value: '1 day', status: 'info', statusLabel: 'In review' },
          { id: 'a4', title: 'Warehouse 3 stock audit', meta: 'Inventory · Suresh K', value: '3 days', status: 'warning', statusLabel: 'Due soon' },
          { id: 'a5', title: 'New joiner IT asset issue', meta: 'People · Divya S', value: '4 hrs', status: 'success', statusLabel: 'On track' },
          { id: 'a6', title: 'Renewal quote — 200 seats', meta: 'Admin · Karthik V', value: '9 days', status: 'neutral', statusLabel: 'Draft' },
        ],
      },
    },
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    key: 'people',
    label: 'People',
    icon: Users,
    title: 'People',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Headcount, hiring and retention at a glance.' },
      { key: 'directory', label: 'Directory', layout: 'list', blurb: 'Every employee record, filterable by branch and department.' },
      { key: 'onboarding', label: 'Onboarding', layout: 'split', blurb: 'Joiners in flight and the tasks still blocking their day one.' },
      { key: 'documents', label: 'Documents', layout: 'grid', blurb: 'Contracts, IDs and statutory paperwork by completeness.' },
      { key: 'org', label: 'Org chart', layout: 'trend', blurb: 'How reporting lines and span of control have shifted.' },
    ],
    data: {
      kpis: [
        { label: 'Total headcount', value: '1,284', sub: '1,096 full-time', delta: '3.2%', dir: 'up', good: true },
        { label: 'New hires (QTD)', value: '96', sub: '71 replacements', delta: '14.3%', dir: 'up', good: true },
        { label: 'Attrition rate', value: '8.4%', sub: 'trailing 12 months', delta: '1.1%', dir: 'down', good: true },
        { label: 'Average tenure', value: '3.2 yrs', sub: 'median 2.7 yrs', delta: '0.3%', dir: 'up', good: true },
      ],
      area: {
        title: 'Joiners and leavers',
        blurb: 'Monthly movement in and out of the organisation.',
        series: ['Joiners', 'Leavers'],
        fmt: nf,
        data: mkArea(
          [34, 41, 38, 52, 47, 44, 61, 58, 49, 66, 72, 68],
          [21, 24, 19, 28, 31, 26, 33, 29, 22, 30, 27, 25],
        ),
      },
      bar: {
        title: 'Headcount by department',
        blurb: 'Confirmed employees, excluding contractors and interns.',
        measure: 'Employees',
        fmt: nf,
        data: [
          { x: 'Production', v: 486 }, { x: 'Quality', v: 184 }, { x: 'Supply chain', v: 152 },
          { x: 'Engineering', v: 146 }, { x: 'Sales', v: 128 }, { x: 'Finance', v: 104 },
          { x: 'People ops', v: 84 },
        ],
      },
      stack: {
        title: 'Hiring funnel',
        blurb: 'Candidates progressing through each stage, by week.',
        keys: ['Screened', 'Interviewed', 'Offered'],
        fmt: nf,
        data: mkStack([124, 138, 116, 142, 156, 148], [62, 71, 58, 74, 82, 79], [18, 22, 16, 24, 27, 26]),
      },
      donut: {
        title: 'Workforce composition',
        blurb: 'Every person on the roster by engagement type.',
        totalLabel: 'People',
        fmt: nf,
        data: [
          { name: 'Full-time', value: 1096 }, { name: 'Contract', value: 118 },
          { name: 'Apprentice', value: 46 }, { name: 'Intern', value: 24 },
        ],
      },
      table: {
        title: 'Onboarding in progress',
        blurb: 'Joiners in their first thirty days and their checklist state.',
        columns: ['Employee', 'Role · Start date', 'Progress'],
        rows: [
          { id: 'p1', title: 'Ananya Sharma', meta: 'Process Engineer · 04 Aug', value: '9 / 11', status: 'success', statusLabel: 'On track' },
          { id: 'p2', title: 'Vikram Desai', meta: 'QA Analyst · 04 Aug', value: '6 / 11', status: 'info', statusLabel: 'In progress' },
          { id: 'p3', title: 'Meera Krishnan', meta: 'Finance Exec · 28 Jul', value: '4 / 11', status: 'warning', statusLabel: 'At risk' },
          { id: 'p4', title: 'Arjun Pillai', meta: 'Line Supervisor · 21 Jul', value: '3 / 11', status: 'danger', statusLabel: 'Blocked' },
          { id: 'p5', title: 'Sneha Iyer', meta: 'HR Partner · 11 Aug', value: '11 / 11', status: 'success', statusLabel: 'Complete' },
          { id: 'p6', title: 'Rohit Bansal', meta: 'Store Keeper · 18 Aug', value: '0 / 11', status: 'neutral', statusLabel: 'Not started' },
        ],
      },
    },
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  {
    key: 'attendance',
    label: 'Attendance',
    icon: Clock,
    title: 'Attendance & time',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Presence, punctuality and overtime across every shift.' },
      { key: 'daily', label: 'Daily log', layout: 'list', blurb: 'Punch records for today, by branch and shift.' },
      { key: 'shifts', label: 'Shifts', layout: 'grid', blurb: 'Roster coverage and how each shift pattern is staffed.' },
      { key: 'overtime', label: 'Overtime', layout: 'trend', blurb: 'Approved overtime hours and their cost trajectory.' },
      { key: 'exceptions', label: 'Exceptions', layout: 'split', blurb: 'Missed punches, geofence breaches and manual edits.' },
    ],
    data: {
      kpis: [
        { label: 'Present today', value: '1,147', sub: 'of 1,284 expected', delta: '2.1%', dir: 'up', good: true },
        { label: 'Average hours', value: '8.4 h', sub: 'per working day', delta: '0.2%', dir: 'up', good: true },
        { label: 'Late marks', value: '62', sub: 'this week', delta: '18.0%', dir: 'up', good: false },
        { label: 'Overtime logged', value: '1,940 h', sub: 'month to date', delta: '6.4%', dir: 'down', good: true },
      ],
      area: {
        title: 'Presence trend',
        blurb: 'Daily headcount present versus on approved leave.',
        series: ['Present', 'On leave'],
        fmt: nf,
        data: mkArea(
          [1102, 1118, 1094, 1136, 1121, 1148, 1109, 1132, 1156, 1141, 1163, 1147],
          [118, 104, 132, 96, 108, 88, 121, 102, 84, 96, 79, 91],
        ),
      },
      bar: {
        title: 'Attendance rate by branch',
        blurb: 'Share of scheduled hours actually worked this month.',
        measure: 'Attendance',
        fmt: pct,
        data: [
          { x: 'Bengaluru', v: 94 }, { x: 'Pune', v: 91 }, { x: 'Chennai', v: 89 },
          { x: 'Hosur', v: 87 }, { x: 'Coimbatore', v: 85 }, { x: 'Nashik', v: 82 },
        ],
      },
      stack: {
        title: 'Day classification',
        blurb: 'How each recorded working day was classified.',
        keys: ['On time', 'Late', 'Absent'],
        fmt: nf,
        data: mkStack([1042, 1068, 1011, 1084, 1096, 1072], [96, 84, 118, 76, 68, 62], [146, 132, 155, 124, 120, 118]),
      },
      donut: {
        title: 'Leave mix',
        blurb: 'Approved leave days taken so far this quarter.',
        totalLabel: 'Leave days',
        fmt: nf,
        data: [
          { name: 'Earned', value: 1840 }, { name: 'Casual', value: 962 },
          { name: 'Sick', value: 604 }, { name: 'Unpaid', value: 148 },
        ],
      },
      table: {
        title: 'Exceptions today',
        blurb: 'Records a supervisor needs to confirm before payroll cut-off.',
        columns: ['Employee', 'Branch · Shift', 'Recorded'],
        rows: [
          { id: 't1', title: 'Ganesh Murthy', meta: 'Hosur · Shift B', value: 'No out-punch', status: 'danger', statusLabel: 'Missing' },
          { id: 't2', title: 'Lakshmi Reddy', meta: 'Bengaluru · General', value: '10:42 in', status: 'warning', statusLabel: 'Late' },
          { id: 't3', title: 'Imran Sheikh', meta: 'Pune · Shift A', value: 'Outside zone', status: 'danger', statusLabel: 'Geofence' },
          { id: 't4', title: 'Deepa Nambiar', meta: 'Chennai · General', value: 'Edited 09:00', status: 'info', statusLabel: 'Manual edit' },
          { id: 't5', title: 'Sathish Kumar', meta: 'Coimbatore · Shift C', value: '12.5 h', status: 'warning', statusLabel: 'Over limit' },
          { id: 't6', title: 'Nisha Verma', meta: 'Nashik · General', value: 'Approved', status: 'success', statusLabel: 'Resolved' },
        ],
      },
    },
  },

  // ── Payroll ───────────────────────────────────────────────────────────────
  {
    key: 'payroll',
    label: 'Payroll',
    icon: CreditCard,
    title: 'Payroll',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Cost, coverage and compliance for the current cycle.' },
      { key: 'runs', label: 'Pay runs', layout: 'list', blurb: 'Every cycle you have processed and its current state.' },
      { key: 'payslips', label: 'Payslips', layout: 'split', blurb: 'Issued, viewed and bounced payslips for this cycle.' },
      { key: 'components', label: 'Components', layout: 'grid', blurb: 'Earnings and deduction heads and how much each contributes.' },
      { key: 'compliance', label: 'Compliance', layout: 'trend', blurb: 'Statutory filings, contributions and their due dates.' },
    ],
    data: {
      kpis: [
        { label: 'Gross payroll', value: '₹4.82 Cr', sub: 'March 2026 cycle', delta: '2.4%', dir: 'up', good: false },
        { label: 'Net disbursed', value: '₹4.11 Cr', sub: '1,268 accounts credited', delta: '2.1%', dir: 'up', good: true },
        { label: 'Total deductions', value: '₹71.4 L', sub: 'statutory + voluntary', delta: '0.9%', dir: 'up', good: false },
        { label: 'Cost per employee', value: '₹37,540', sub: 'fully loaded, monthly', delta: '0.6%', dir: 'down', good: true },
      ],
      area: {
        title: 'Gross versus net payroll',
        blurb: 'Monthly payroll cost before and after deductions, in crore.',
        series: ['Gross', 'Net'],
        fmt: cr,
        data: mkArea(
          [4.21, 4.28, 4.34, 4.39, 4.46, 4.51, 4.58, 4.64, 4.69, 4.72, 4.78, 4.82],
          [3.62, 3.68, 3.72, 3.76, 3.82, 3.86, 3.92, 3.97, 4.01, 4.04, 4.08, 4.11],
        ),
      },
      bar: {
        title: 'Payroll cost by department',
        blurb: 'Fully loaded monthly cost in lakh, current cycle.',
        measure: 'Cost',
        fmt: lakh,
        data: [
          { x: 'Production', v: 168 }, { x: 'Engineering', v: 92 }, { x: 'Quality', v: 64 },
          { x: 'Supply chain', v: 58 }, { x: 'Sales', v: 46 }, { x: 'Finance', v: 32 },
          { x: 'People ops', v: 22 },
        ],
      },
      stack: {
        title: 'Cost composition',
        blurb: 'How each cycle splits across pay heads, in lakh.',
        keys: ['Fixed pay', 'Variable pay', 'Employer contribution'],
        fmt: lakh,
        data: mkStack([328, 331, 336, 340, 344, 348], [72, 78, 69, 84, 91, 88], [46, 47, 47, 48, 48, 49]),
      },
      donut: {
        title: 'Deduction split',
        blurb: 'Every rupee withheld this cycle, in lakh.',
        totalLabel: 'Deducted',
        fmt: lakh,
        data: [
          { name: 'Income tax', value: 312 }, { name: 'Provident fund', value: 246 },
          { name: 'ESI', value: 98 }, { name: 'Advances', value: 58 },
        ],
      },
      table: {
        title: 'Recent pay runs',
        blurb: 'The last six cycles and where each one stands.',
        columns: ['Cycle', 'Employees · Branch', 'Net value'],
        rows: [
          { id: 'r1', title: 'March 2026', meta: '1,268 employees · All', value: '₹4.11 Cr', status: 'info', statusLabel: 'Processing' },
          { id: 'r2', title: 'February 2026', meta: '1,254 employees · All', value: '₹4.08 Cr', status: 'success', statusLabel: 'Disbursed' },
          { id: 'r3', title: 'January 2026', meta: '1,241 employees · All', value: '₹4.04 Cr', status: 'success', statusLabel: 'Disbursed' },
          { id: 'r4', title: 'Dec 2025 — bonus', meta: '1,236 employees · All', value: '₹86.2 L', status: 'success', statusLabel: 'Disbursed' },
          { id: 'r5', title: 'December 2025', meta: '1,236 employees · All', value: '₹4.01 Cr', status: 'success', statusLabel: 'Disbursed' },
          { id: 'r6', title: 'Nov 2025 — arrears', meta: '84 employees · Hosur', value: '₹6.4 L', status: 'warning', statusLabel: 'Partly failed' },
        ],
      },
    },
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    key: 'finance',
    label: 'Finance',
    icon: DollarSign,
    title: 'Finance',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Cash position, receivables and spend for the current quarter.' },
      { key: 'invoices', label: 'Invoices', layout: 'list', blurb: 'Raised, settled and overdue invoices across all customers.' },
      { key: 'expenses', label: 'Expenses', layout: 'split', blurb: 'Claims and vendor bills grouped by category.' },
      { key: 'ledger', label: 'Ledger', layout: 'grid', blurb: 'Account balances and how they moved this period.' },
      { key: 'budgets', label: 'Budgets', layout: 'trend', blurb: 'Planned versus actual spend by cost centre.' },
    ],
    data: {
      kpis: [
        { label: 'Revenue (QTD)', value: '₹18.6 Cr', sub: 'against ₹17.4 Cr plan', delta: '6.9%', dir: 'up', good: true },
        { label: 'Receivables', value: '₹3.24 Cr', sub: '₹62 L over 60 days', delta: '4.2%', dir: 'up', good: false },
        { label: 'Payables', value: '₹1.87 Cr', sub: '148 open bills', delta: '3.1%', dir: 'down', good: true },
        { label: 'Cash runway', value: '14 mo', sub: 'at current burn', delta: '1.0%', dir: 'up', good: true },
      ],
      area: {
        title: 'Cash movement',
        blurb: 'Money in and money out each month, in crore.',
        series: ['Inflow', 'Outflow'],
        fmt: cr,
        data: mkArea(
          [5.42, 5.68, 5.91, 6.12, 5.88, 6.34, 6.58, 6.21, 6.72, 6.94, 7.18, 7.42],
          [4.86, 4.92, 5.14, 5.02, 5.38, 5.21, 5.46, 5.62, 5.41, 5.78, 5.92, 6.08],
        ),
      },
      bar: {
        title: 'Revenue by business unit',
        blurb: 'Recognised revenue this quarter, in lakh.',
        measure: 'Revenue',
        fmt: lakh,
        data: [
          { x: 'Precision parts', v: 742 }, { x: 'Assemblies', v: 518 }, { x: 'Tooling', v: 364 },
          { x: 'Aftermarket', v: 246 }, { x: 'Services', v: 182 }, { x: 'Exports', v: 148 },
        ],
      },
      stack: {
        title: 'Receivables ageing',
        blurb: 'Outstanding balance by how long it has been owed, in lakh.',
        keys: ['0–30 days', '31–60 days', 'Over 60 days'],
        fmt: lakh,
        data: mkStack([186, 198, 174, 212, 204, 196], [82, 74, 91, 68, 72, 66], [48, 52, 58, 54, 60, 62]),
      },
      donut: {
        title: 'Where the money goes',
        blurb: 'Operating spend this quarter, in lakh.',
        totalLabel: 'Spend',
        fmt: lakh,
        data: [
          { name: 'Raw material', value: 864 }, { name: 'People', value: 482 },
          { name: 'Logistics', value: 196 }, { name: 'Overheads', value: 124 },
        ],
      },
      table: {
        title: 'Open invoices',
        blurb: 'The largest balances still awaiting settlement.',
        columns: ['Customer', 'Invoice · Due date', 'Balance'],
        rows: [
          { id: 'f1', title: 'Tata Auto Components', meta: 'INV-4821 · 12 Jul', value: '₹48.2 L', status: 'danger', statusLabel: '58 days late' },
          { id: 'f2', title: 'Bharat Forge Ltd', meta: 'INV-4906 · 02 Aug', value: '₹32.6 L', status: 'warning', statusLabel: '6 days late' },
          { id: 'f3', title: 'Sundaram Fasteners', meta: 'INV-4954 · 22 Aug', value: '₹28.4 L', status: 'info', statusLabel: 'Due soon' },
          { id: 'f4', title: 'Wheels India', meta: 'INV-4961 · 29 Aug', value: '₹21.8 L', status: 'success', statusLabel: 'Current' },
          { id: 'f5', title: 'Rane Holdings', meta: 'INV-4972 · 04 Sep', value: '₹18.2 L', status: 'success', statusLabel: 'Current' },
          { id: 'f6', title: 'Endurance Tech', meta: 'INV-4988 · 11 Sep', value: '₹14.6 L', status: 'neutral', statusLabel: 'Draft' },
        ],
      },
    },
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Package,
    title: 'Inventory',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Stock value, turns and availability across every warehouse.' },
      { key: 'stock', label: 'Stock', layout: 'list', blurb: 'On-hand quantity per SKU with reorder thresholds.' },
      { key: 'warehouses', label: 'Warehouses', layout: 'grid', blurb: 'Capacity, occupancy and value held at each location.' },
      { key: 'movements', label: 'Movements', layout: 'trend', blurb: 'Goods received and issued over the last twelve months.' },
      { key: 'suppliers', label: 'Suppliers', layout: 'split', blurb: 'Vendor performance on lead time and quality.' },
    ],
    data: {
      kpis: [
        { label: 'SKUs tracked', value: '8,412', sub: '212 added this month', delta: '2.6%', dir: 'up', good: true },
        { label: 'Stock value', value: '₹6.9 Cr', sub: 'at moving average cost', delta: '4.8%', dir: 'up', good: false },
        { label: 'Inventory turns', value: '5.8 / yr', sub: 'target 6.5', delta: '0.4%', dir: 'up', good: true },
        { label: 'Stock-outs', value: '23', sub: 'SKUs below safety level', delta: '9.0%', dir: 'down', good: true },
      ],
      area: {
        title: 'Goods movement',
        blurb: 'Units received into and issued from stores each month.',
        series: ['Inbound', 'Outbound'],
        fmt: units,
        data: mkArea(
          [42800, 44100, 41600, 46200, 47800, 45400, 49100, 51200, 48600, 52400, 54100, 55800],
          [40200, 42600, 43100, 44800, 45200, 46900, 47400, 49800, 50200, 51100, 52800, 54200],
        ),
      },
      bar: {
        title: 'Stock value by warehouse',
        blurb: 'Closing value held at each location, in lakh.',
        measure: 'Value',
        fmt: lakh,
        data: [
          { x: 'Hosur WH1', v: 248 }, { x: 'Pune WH2', v: 186 }, { x: 'Bengaluru', v: 142 },
          { x: 'Chennai', v: 96 }, { x: 'Nashik', v: 74 }, { x: 'Transit', v: 42 },
        ],
      },
      stack: {
        title: 'Stock health',
        blurb: 'SKUs by availability band, week over week.',
        keys: ['Healthy', 'Low', 'Critical'],
        fmt: nf,
        data: mkStack([7860, 7912, 7884, 7948, 7996, 8042], [284, 262, 296, 248, 232, 218], [46, 41, 52, 38, 31, 23]),
      },
      donut: {
        title: 'Value by category',
        blurb: 'Where the ₹6.9 Cr of stock is concentrated, in lakh.',
        totalLabel: 'Stock value',
        fmt: lakh,
        data: [
          { name: 'Raw material', value: 386 }, { name: 'Work in progress', value: 182 },
          { name: 'Finished goods', value: 96 }, { name: 'Consumables', value: 24 },
        ],
      },
      table: {
        title: 'Reorder queue',
        blurb: 'Items at or below their safety stock level.',
        columns: ['Item', 'Warehouse · Lead time', 'On hand'],
        rows: [
          { id: 'i1', title: 'Bearing housing 62-A', meta: 'Hosur WH1 · 14 days', value: '0 u', status: 'danger', statusLabel: 'Stock-out' },
          { id: 'i2', title: 'Alloy rod 18mm', meta: 'Pune WH2 · 9 days', value: '42 u', status: 'danger', statusLabel: 'Critical' },
          { id: 'i3', title: 'Hydraulic seal kit', meta: 'Hosur WH1 · 21 days', value: '118 u', status: 'warning', statusLabel: 'Low' },
          { id: 'i4', title: 'Cutting fluid 20L', meta: 'Bengaluru · 5 days', value: '96 u', status: 'warning', statusLabel: 'Low' },
          { id: 'i5', title: 'Precision gauge set', meta: 'Chennai · 30 days', value: '14 u', status: 'info', statusLabel: 'PO raised' },
          { id: 'i6', title: 'Weld wire 1.2mm', meta: 'Nashik · 7 days', value: '640 u', status: 'success', statusLabel: 'Healthy' },
        ],
      },
    },
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    key: 'crm',
    label: 'CRM',
    icon: TrendingUp,
    title: 'Customer relationships',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Pipeline health, conversion and revenue concentration.' },
      { key: 'pipeline', label: 'Pipeline', layout: 'grid', blurb: 'Open opportunities by stage and expected close.' },
      { key: 'leads', label: 'Leads', layout: 'list', blurb: 'Inbound and outbound leads awaiting qualification.' },
      { key: 'accounts', label: 'Accounts', layout: 'split', blurb: 'Customer accounts by size, segment and health.' },
      { key: 'activities', label: 'Activities', layout: 'trend', blurb: 'Calls, meetings and follow-ups logged by the team.' },
    ],
    data: {
      kpis: [
        { label: 'Open pipeline', value: '₹12.4 Cr', sub: '214 live opportunities', delta: '8.6%', dir: 'up', good: true },
        { label: 'Win rate', value: '31.6%', sub: 'trailing two quarters', delta: '2.4%', dir: 'up', good: true },
        { label: 'Average deal', value: '₹58.0 L', sub: 'weighted by stage', delta: '1.8%', dir: 'down', good: false },
        { label: 'Sales cycle', value: '42 days', sub: 'lead to signature', delta: '4.1%', dir: 'down', good: true },
      ],
      area: {
        title: 'Created versus won',
        blurb: 'Opportunity value entering and leaving the pipeline, in crore.',
        series: ['Created', 'Won'],
        fmt: cr,
        data: mkArea(
          [2.14, 2.42, 2.28, 2.68, 2.86, 2.54, 3.12, 3.34, 2.98, 3.46, 3.68, 3.92],
          [0.68, 0.82, 0.74, 0.91, 0.96, 0.88, 1.08, 1.16, 1.02, 1.21, 1.28, 1.36],
        ),
      },
      bar: {
        title: 'Pipeline by stage',
        blurb: 'Open value at each stage, in lakh. Stages are ordered, so the ramp reads as progression.',
        measure: 'Open value',
        fmt: lakh,
        ordinal: true,
        data: [
          { x: 'Qualify', v: 412 }, { x: 'Discover', v: 348 }, { x: 'Propose', v: 264 },
          { x: 'Negotiate', v: 148 }, { x: 'Contract', v: 68 },
        ],
      },
      stack: {
        title: 'Deals by source',
        blurb: 'New opportunities created each week, by origin.',
        keys: ['Inbound', 'Outbound', 'Partner'],
        fmt: nf,
        data: mkStack([28, 32, 26, 36, 41, 38], [18, 21, 24, 19, 22, 26], [9, 12, 8, 14, 11, 15]),
      },
      donut: {
        title: 'Revenue by segment',
        blurb: 'Closed-won value this year, in lakh.',
        totalLabel: 'Closed won',
        fmt: lakh,
        data: [
          { name: 'Enterprise OEM', value: 684 }, { name: 'Mid-market', value: 412 },
          { name: 'Aftermarket', value: 218 }, { name: 'Export', value: 96 },
        ],
      },
      table: {
        title: 'Closing this month',
        blurb: 'Opportunities with a committed close date in the next 30 days.',
        columns: ['Opportunity', 'Owner · Close date', 'Value'],
        rows: [
          { id: 'c1', title: 'Bharat Forge — tooling renewal', meta: 'Priya Nair · 22 Aug', value: '₹1.24 Cr', status: 'success', statusLabel: 'Committed' },
          { id: 'c2', title: 'Wheels India — new line', meta: 'Karthik V · 27 Aug', value: '₹86.4 L', status: 'info', statusLabel: 'Negotiating' },
          { id: 'c3', title: 'Rane — annual contract', meta: 'Anita Rao · 29 Aug', value: '₹62.8 L', status: 'warning', statusLabel: 'Slipping' },
          { id: 'c4', title: 'Endurance — pilot batch', meta: 'Rahul Menon · 30 Aug', value: '₹41.2 L', status: 'info', statusLabel: 'Negotiating' },
          { id: 'c5', title: 'Sundaram — spares supply', meta: 'Divya S · 04 Sep', value: '₹28.6 L', status: 'danger', statusLabel: 'At risk' },
          { id: 'c6', title: 'TVS — evaluation', meta: 'Suresh K · 09 Sep', value: '₹18.4 L', status: 'neutral', statusLabel: 'Early' },
        ],
      },
    },
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    key: 'reports',
    label: 'Reports',
    icon: FileBarChart2,
    title: 'Reports & analytics',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'How reporting is being used across the workspace.' },
      { key: 'scheduled', label: 'Scheduled', layout: 'list', blurb: 'Recurring reports, their cadence and last delivery.' },
      { key: 'library', label: 'Library', layout: 'split', blurb: 'Saved report definitions grouped by module.' },
      { key: 'exports', label: 'Exports', layout: 'grid', blurb: 'Download volume and the formats people actually use.' },
      { key: 'usage', label: 'Usage', layout: 'trend', blurb: 'Run volume and runtime over the last twelve months.' },
    ],
    data: {
      kpis: [
        { label: 'Reports run', value: '4,182', sub: 'last 30 days', delta: '11.4%', dir: 'up', good: true },
        { label: 'Scheduled reports', value: '64', sub: '58 delivering cleanly', delta: '6.7%', dir: 'up', good: true },
        { label: 'Average runtime', value: '2.8 s', sub: 'p95 at 9.4 s', delta: '12.0%', dir: 'down', good: true },
        { label: 'Failed runs', value: '11', sub: '0.26% of all runs', delta: '3.0%', dir: 'down', good: true },
      ],
      area: {
        title: 'Report volume',
        blurb: 'Interactive runs and file exports each month.',
        series: ['Runs', 'Exports'],
        fmt: nf,
        data: mkArea(
          [2140, 2380, 2510, 2740, 2960, 3120, 3340, 3520, 3680, 3840, 4020, 4182],
          [640, 712, 748, 826, 894, 938, 1012, 1084, 1128, 1184, 1246, 1308],
        ),
      },
      bar: {
        title: 'Most-run reports',
        blurb: 'Execution count over the last 30 days.',
        measure: 'Runs',
        fmt: nf,
        data: [
          { x: 'Attendance', v: 984 }, { x: 'Headcount', v: 762 }, { x: 'Payroll cost', v: 618 },
          { x: 'Leave balance', v: 486 }, { x: 'Attrition', v: 342 }, { x: 'Stock ageing', v: 264 },
        ],
      },
      stack: {
        title: 'Runs by module',
        blurb: 'Where report demand is coming from, week by week.',
        keys: ['People', 'Finance', 'Operations'],
        fmt: nf,
        data: mkStack([482, 508, 464, 534, 561, 588], [214, 228, 206, 246, 258, 272], [128, 141, 124, 152, 164, 178]),
      },
      donut: {
        title: 'Delivery channel',
        blurb: 'How finished reports reach their audience.',
        totalLabel: 'Deliveries',
        fmt: nf,
        data: [
          { name: 'In-app', value: 2874 }, { name: 'Email', value: 906 },
          { name: 'Scheduled file', value: 312 }, { name: 'API pull', value: 90 },
        ],
      },
      table: {
        title: 'Scheduled reports',
        blurb: 'Recurring deliveries and the state of their last run.',
        columns: ['Report', 'Cadence · Recipients', 'Last run'],
        rows: [
          { id: 'q1', title: 'Daily attendance summary', meta: 'Every day 07:00 · 24 people', value: 'Today 07:00', status: 'success', statusLabel: 'Delivered' },
          { id: 'q2', title: 'Weekly payroll variance', meta: 'Mondays 09:00 · 6 people', value: '4 days ago', status: 'success', statusLabel: 'Delivered' },
          { id: 'q3', title: 'Monthly attrition pack', meta: '1st of month · 11 people', value: '8 days ago', status: 'warning', statusLabel: 'Partial' },
          { id: 'q4', title: 'Stock ageing export', meta: 'Fridays 18:00 · 4 people', value: '2 days ago', status: 'danger', statusLabel: 'Failed' },
          { id: 'q5', title: 'Quarterly diversity report', meta: 'Quarterly · 3 people', value: '21 days ago', status: 'success', statusLabel: 'Delivered' },
          { id: 'q6', title: 'Receivables ageing', meta: 'Daily 20:00 · 8 people', value: 'Paused', status: 'neutral', statusLabel: 'Paused' },
        ],
      },
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    title: 'Workspace settings',
    tabs: [
      { key: 'overview', label: 'Overview', layout: 'overview', blurb: 'Access, security posture and configuration health.' },
      { key: 'users', label: 'Users', layout: 'list', blurb: 'Everyone with a login and when they were last active.' },
      { key: 'roles', label: 'Roles', layout: 'grid', blurb: 'Permission sets and how many people hold each one.' },
      { key: 'integrations', label: 'Integrations', layout: 'split', blurb: 'Connected systems and their sync status.' },
      { key: 'audit', label: 'Audit log', layout: 'trend', blurb: 'Every privileged action recorded in this workspace.' },
    ],
    data: {
      kpis: [
        { label: 'Active users', value: '342', sub: 'signed in this month', delta: '4.6%', dir: 'up', good: true },
        { label: 'Roles defined', value: '18', sub: '4 custom, 14 standard', delta: '2.0%', dir: 'up', good: true },
        { label: 'Integrations live', value: '9', sub: '1 needs reauthorisation', delta: '1.0%', dir: 'up', good: true },
        { label: 'Audit events', value: '12,480', sub: 'last 90 days', delta: '7.2%', dir: 'up', good: true },
      ],
      area: {
        title: 'Sign-in activity',
        blurb: 'Successful and failed authentication attempts each month.',
        series: ['Successful', 'Failed'],
        fmt: nf,
        data: mkArea(
          [4820, 5140, 5320, 5680, 5940, 6120, 6480, 6740, 6920, 7180, 7420, 7680],
          [186, 204, 168, 224, 241, 196, 262, 218, 184, 208, 176, 164],
        ),
      },
      bar: {
        title: 'Users by role',
        blurb: 'How many people hold each permission set.',
        measure: 'Users',
        fmt: nf,
        data: [
          { x: 'Employee', v: 214 }, { x: 'Manager', v: 62 }, { x: 'HR partner', v: 28 },
          { x: 'Finance', v: 18 }, { x: 'Store keeper', v: 14 }, { x: 'Admin', v: 6 },
        ],
      },
      stack: {
        title: 'Access changes',
        blurb: 'Permission grants, edits and revocations by week.',
        keys: ['Granted', 'Modified', 'Revoked'],
        fmt: nf,
        data: mkStack([24, 18, 31, 22, 27, 19], [12, 16, 9, 21, 14, 18], [8, 11, 6, 14, 9, 12]),
      },
      donut: {
        title: 'Authentication method',
        blurb: 'How the 342 active users sign in.',
        totalLabel: 'Users',
        fmt: nf,
        data: [
          { name: 'SSO', value: 208 }, { name: 'Password + MFA', value: 96 },
          { name: 'Password only', value: 32 }, { name: 'Service account', value: 6 },
        ],
      },
      table: {
        title: 'Recent audit events',
        blurb: 'Privileged actions recorded across the workspace.',
        columns: ['Event', 'Actor · Source', 'When'],
        rows: [
          { id: 's1', title: 'Role "Finance lead" edited', meta: 'Karthik V · Web', value: '12 min ago', status: 'warning', statusLabel: 'Privileged' },
          { id: 's2', title: 'Payroll export downloaded', meta: 'Priya Nair · Web', value: '1 hr ago', status: 'warning', statusLabel: 'Privileged' },
          { id: 's3', title: 'SSO metadata refreshed', meta: 'System · Scheduler', value: '3 hrs ago', status: 'info', statusLabel: 'Automated' },
          { id: 's4', title: 'User invited — 4 people', meta: 'Divya S · Web', value: '5 hrs ago', status: 'success', statusLabel: 'Routine' },
          { id: 's5', title: 'Failed sign-in ×6', meta: 'unknown · 103.21.x.x', value: '9 hrs ago', status: 'danger', statusLabel: 'Investigate' },
          { id: 's6', title: 'API key rotated', meta: 'Rahul Menon · CLI', value: '1 day ago', status: 'neutral', statusLabel: 'Routine' },
        ],
      },
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Status pills — reserved status colours, always icon + label (never colour alone)
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<StatusKey, { cls: string; Icon: LucideIcon }> = {
  success: { cls: 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-[var(--status-success-border)]', Icon: CheckCircle2 },
  warning: { cls: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-[var(--status-warning-border)]', Icon: AlertTriangle },
  danger: { cls: 'bg-[var(--status-error-bg)] text-[var(--status-error-fg)] ring-[var(--status-error-border)]', Icon: AlertCircle },
  info: { cls: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] ring-[var(--status-info-border)]', Icon: Clock3 },
  neutral: { cls: 'bg-[var(--bg-subtle)] text-[var(--text-tertiary)] ring-[var(--border-default)]', Icon: CircleDot },
}

function StatusPill({ status, label }: { status: StatusKey; label: string }) {
  const { cls, Icon } = STATUS_STYLE[status]
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset', cls)}>
      <Icon size={12} aria-hidden />
      {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared card chrome
// ─────────────────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('ut-card', className)}>
      {children}
    </div>
  )
}

function CardHead({ title, blurb, right }: { title: string; blurb: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h3 className="font-heading text-[15px] font-bold leading-tight text-[var(--text-primary)]" style={{ letterSpacing: '-0.02em' }}>
          {title}
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-tertiary)]">{blurb}</p>
      </div>
      {right}
    </div>
  )
}

/** Legend chips — identity is never colour-alone, and the value doubles as the
 *  visible-label relief the light ramp steps require. */
function Legend({ items }: { items: Array<{ name: string; color: string; value?: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-4 pt-1">
      {items.map(it => (
        <li key={it.name} className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: it.color }} />
          <span className="font-medium">{it.name}</span>
          {it.value && <span className="tabular-nums text-[var(--text-tertiary)]">{it.value}</span>}
        </li>
      ))}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip (crosshair + per-mark hover ships on every chart by default)
// ─────────────────────────────────────────────────────────────────────────────
interface TipEntry { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }
interface TipProps { active?: boolean; label?: string | number; payload?: TipEntry[]; fmt: (n: number) => string }

function ChartTooltip({ active, label, payload, fmt }: TipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="pointer-events-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</p>
      <ul className="space-y-1">
        {payload.map((p, i) => (
          <li key={`${p.dataKey ?? i}`} className="flex items-center gap-2 text-[12px]">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: p.color }} />
            <span className="text-[var(--text-secondary)]">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-[var(--text-primary)]">
              {typeof p.value === 'number' ? fmt(p.value) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const AXIS_TICK = { fill: 'var(--mw-axis)', fontSize: 11 }
const GRID_PROPS = { stroke: 'var(--mw-grid)', strokeDasharray: '3 3', vertical: false } as const

// ─────────────────────────────────────────────────────────────────────────────
// KPI stat card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ kpi, index }: { kpi: Kpi; index: number }) {
  const reduce = useReducedMotion()
  const Arrow = kpi.dir === 'up' ? ArrowUpRight : ArrowDownRight
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduce ? 0 : index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="group ut-card ut-card-sm p-5"
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{kpi.label}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span
          className="font-heading font-extrabold leading-none text-[var(--text-primary)]"
          style={{ fontSize: 'clamp(1.6rem, 2.4vw, 2rem)', letterSpacing: '-0.035em' }}
        >
          {kpi.value}
        </span>
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
            kpi.good
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-[var(--status-success-border)]'
              : 'bg-[var(--status-error-bg)] text-[var(--status-error-fg)] ring-[var(--status-error-border)]',
          )}
        >
          <Arrow size={12} aria-hidden />
          {kpi.delta}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{kpi.sub}</p>
    </motion.div>
  )
}

function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((k, i) => <KpiCard key={k.label} kpi={k} index={i} />)}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────
function TrendAreaCard({ spec, tall, gradientId }: { spec: AreaSpec; tall?: boolean; gradientId: string }) {
  const last = spec.data[spec.data.length - 1]
  return (
    <Card className="overflow-hidden">
      <CardHead title={spec.title} blurb={spec.blurb} />
      <div className={clsx('px-2', tall ? 'h-[300px]' : 'h-[232px]')}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spec.data} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id={`${gradientId}-a`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AREA_COLORS[0]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={AREA_COLORS[0]} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={`${gradientId}-b`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AREA_COLORS[1]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={AREA_COLORS[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickMargin={4} />
            <Tooltip
              cursor={{ stroke: 'var(--mw-axis)', strokeWidth: 1, strokeDasharray: '4 4' }}
              content={props => <ChartTooltip {...(props as TipProps)} fmt={spec.fmt} />}
            />
            <Area
              type="monotone" dataKey="a" name={spec.series[0]} stroke={AREA_COLORS[0]} strokeWidth={2}
              fill={`url(#${gradientId}-a)`} dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--mw-plot)' }}
            />
            <Area
              type="monotone" dataKey="b" name={spec.series[1]} stroke={AREA_COLORS[1]} strokeWidth={2}
              fill={`url(#${gradientId}-b)`} dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--mw-plot)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { name: spec.series[0], color: AREA_COLORS[0], value: spec.fmt(last.a) },
          { name: spec.series[1], color: AREA_COLORS[1], value: spec.fmt(last.b) },
        ]}
      />
    </Card>
  )
}

function ComparisonBarCard({ spec }: { spec: BarSpec }) {
  // Nominal categories all take the same slot-1 hue — bar length already encodes
  // the value, so spending the identity channel on it would be redundant.
  // Ordinal categories (stages) take monotone ramp steps instead.
  const ordinalRamp = ORDINAL_COLORS
  return (
    <Card className="overflow-hidden">
      <CardHead title={spec.title} blurb={spec.blurb} />
      <div className="h-[232px] px-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={spec.data} margin={{ top: 20, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={8} interval={0} angle={0} height={34} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickMargin={4} />
            <Tooltip
              cursor={{ fill: 'var(--mw-grid)', fillOpacity: 0.35 }}
              content={props => <ChartTooltip {...(props as TipProps)} fmt={spec.fmt} />}
            />
            <Bar dataKey="v" name={spec.measure} radius={[4, 4, 0, 0]} maxBarSize={44}>
              {spec.data.map((d, i) => (
                <Cell key={d.x} fill={spec.ordinal ? ordinalRamp[i % ordinalRamp.length] : 'var(--mw-solo)'} />
              ))}
              <LabelList dataKey="v" position="top" offset={8} fill="var(--text-secondary)" fontSize={11} formatter={(v: number) => spec.fmt(v)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {spec.ordinal ? (
        <Legend items={spec.data.map((d, i) => ({ name: d.x, color: ordinalRamp[i % ordinalRamp.length], value: spec.fmt(d.v) }))} />
      ) : (
        <p className="px-5 pb-4 pt-1 text-[12px] text-[var(--text-tertiary)]">
          One series — {spec.measure.toLowerCase()}, highest first.
        </p>
      )}
    </Card>
  )
}

function StackedBarCard({ spec }: { spec: StackSpec }) {
  const last = spec.data[spec.data.length - 1]
  const totals: [number, number, number] = [last.a, last.b, last.c]
  return (
    <Card className="overflow-hidden">
      <CardHead title={spec.title} blurb={spec.blurb} />
      <div className="h-[232px] px-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={spec.data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={8} interval={0} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickMargin={4} />
            <Tooltip
              cursor={{ fill: 'var(--mw-grid)', fillOpacity: 0.35 }}
              content={props => <ChartTooltip {...(props as TipProps)} fmt={spec.fmt} />}
            />
            {/* 2px surface stroke = the required gap between touching segments */}
            <Bar dataKey="a" name={spec.keys[0]} stackId="s" fill={STACK_COLORS[0]} stroke="var(--mw-plot)" strokeWidth={2} maxBarSize={46} />
            <Bar dataKey="b" name={spec.keys[1]} stackId="s" fill={STACK_COLORS[1]} stroke="var(--mw-plot)" strokeWidth={2} maxBarSize={46} />
            <Bar dataKey="c" name={spec.keys[2]} stackId="s" fill={STACK_COLORS[2]} stroke="var(--mw-plot)" strokeWidth={2} maxBarSize={46} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={spec.keys.map((k, i) => ({ name: k, color: STACK_COLORS[i], value: spec.fmt(totals[i]) }))} />
    </Card>
  )
}

function CompositionDonutCard({ spec }: { spec: DonutSpec }) {
  const total = useMemo(() => spec.data.reduce((s, d) => s + d.value, 0), [spec.data])
  return (
    <Card className="overflow-hidden">
      <CardHead title={spec.title} blurb={spec.blurb} />
      <div className="relative h-[232px] px-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={props => <ChartTooltip {...(props as TipProps)} fmt={spec.fmt} />} />
            <Pie
              data={spec.data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="var(--mw-plot)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {spec.data.map((d, i) => <Cell key={d.name} fill={PART_COLORS[i % PART_COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-heading font-extrabold leading-none text-[var(--text-primary)]"
            style={{ fontSize: 'clamp(1.35rem, 2vw, 1.7rem)', letterSpacing: '-0.035em' }}
          >
            {spec.fmt(total)}
          </span>
          <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {spec.totalLabel}
          </span>
        </div>
      </div>
      {/* Direct labels for every slice — the composition is readable without colour */}
      <ul className="space-y-2 px-5 pb-5 pt-2">
        {spec.data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2.5 text-[12px]">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: PART_COLORS[i % PART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{d.name}</span>
            <span className="font-semibold tabular-nums text-[var(--text-primary)]">{spec.fmt(d.value)}</span>
            <span className="w-11 shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function StatusTableCard({ spec, dense }: { spec: TableSpec; dense?: boolean }) {
  const rows = dense ? spec.rows : spec.rows.slice(0, 6)
  return (
    <Card className="overflow-hidden">
      <CardHead
        title={spec.title}
        blurb={spec.blurb}
        right={
          <button
            type="button"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] sm:inline-flex"
          >
            <Download size={13} aria-hidden /> Export
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-y border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              {spec.columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={clsx(
                    'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]',
                    i === 2 && 'text-right',
                  )}
                >
                  {c}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-[var(--border-subtle)] transition-colors last:border-0 hover:bg-[var(--bg-subtle)]">
                <td className="px-4 py-2.5">
                  <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{r.title}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="block truncate text-[12px] text-[var(--text-secondary)]">{r.meta}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{r.value}</td>
                <td className="px-4 py-2.5 text-right">
                  <StatusPill status={r.status} label={r.statusLabel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel layouts — the sub-tab picks one; all of them read the module's data
// ─────────────────────────────────────────────────────────────────────────────
function Panel({ mod, tab }: { mod: ModuleDef; tab: SubTab }) {
  const d = mod.data
  const gid = `mw-${mod.key}-${tab.key}`

  const heading = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-fg)]">{mod.title}</p>
        <h2
          className="mt-1.5 font-heading font-extrabold leading-[1.05] text-[var(--text-primary)]"
          style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2rem)', letterSpacing: '-0.035em' }}
        >
          {tab.label}
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--text-secondary)]">{tab.blurb}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
        >
          <SlidersHorizontal size={14} aria-hidden /> Filters
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-solid)] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--accent-solid-hover)]"
        >
          <Download size={14} aria-hidden /> Export view
        </button>
      </div>
    </div>
  )

  let body: React.ReactNode
  switch (tab.layout) {
    case 'overview':
      body = (
        <>
          <KpiRow items={d.kpis} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2"><TrendAreaCard spec={d.area} tall gradientId={gid} /></div>
            <ComparisonBarCard spec={d.bar} />
            <StackedBarCard spec={d.stack} />
            <CompositionDonutCard spec={d.donut} />
            <StatusTableCard spec={d.table} />
          </div>
        </>
      )
      break
    case 'trend':
      body = (
        <>
          <KpiRow items={d.kpis} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><TrendAreaCard spec={d.area} tall gradientId={gid} /></div>
            <CompositionDonutCard spec={d.donut} />
            <div className="lg:col-span-3"><StackedBarCard spec={d.stack} /></div>
          </div>
        </>
      )
      break
    case 'list':
      body = (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {d.kpis.slice(0, 2).map((k, i) => <KpiCard key={k.label} kpi={k} index={i} />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><StatusTableCard spec={d.table} dense /></div>
            <CompositionDonutCard spec={d.donut} />
          </div>
        </>
      )
      break
    case 'split':
      body = (
        <div className="grid gap-4 lg:grid-cols-2">
          <ComparisonBarCard spec={d.bar} />
          <CompositionDonutCard spec={d.donut} />
          <div className="lg:col-span-2"><StatusTableCard spec={d.table} dense /></div>
        </div>
      )
      break
    case 'grid':
    default:
      body = (
        <>
          <KpiRow items={d.kpis} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ComparisonBarCard spec={d.bar} />
            <StackedBarCard spec={d.stack} />
            <CompositionDonutCard spec={d.donut} />
            <TrendAreaCard spec={d.area} gradientId={gid} />
          </div>
        </>
      )
      break
  }

  return (
    <div className="space-y-6">
      {heading}
      {body}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Left icon rail
// ─────────────────────────────────────────────────────────────────────────────
function IconRail({ activeKey, onSelect }: { activeKey: string; onSelect: (k: string) => void }) {
  return (
    <nav
      aria-label="Modules"
      className="scrollbar-hide flex w-[64px] shrink-0 flex-col items-center gap-1 overflow-y-auto bg-[#04503A] py-3 sm:w-[76px]"
    >
      <div className="mb-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/20">
        <span className="font-heading text-[15px] font-extrabold" style={{ letterSpacing: '-0.04em' }}>U</span>
      </div>
      {MODULES.map(m => {
        const active = m.key === activeKey
        const Icon = m.icon
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onSelect(m.key)}
            aria-current={active ? 'page' : undefined}
            title={m.label}
            className={clsx(
              'group relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors duration-200',
              active ? 'text-[#04503A]' : 'text-white/65 hover:text-white',
            )}
          >
            {active && (
              <motion.span
                layoutId="mw-rail-pill"
                aria-hidden
                className="absolute inset-x-1 inset-y-0 rounded-xl bg-[#A7F3D0]"
                style={{ boxShadow: '0 0 0 1px rgba(167,243,208,0.5), 0 8px 24px -6px rgba(52,211,153,0.65)' }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <Icon size={19} className="relative z-10" aria-hidden />
            <span className="relative z-10 text-[10px] font-semibold leading-tight">{m.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────────────────────
function TopBar({ moduleLabel }: { moduleLabel: string }) {
  return (
    <header className="sticky top-0 z-sticky flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-surface-overlay)] px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="min-w-0">
          <p className="truncate font-heading text-[14px] font-bold leading-tight text-[var(--text-primary)]" style={{ letterSpacing: '-0.02em' }}>
            Acme Manufacturing
          </p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">Bengaluru · {moduleLabel}</p>
        </div>
      </div>

      <div className="mx-auto hidden w-full max-w-md md:block">
        <label className="sr-only" htmlFor="mw-search">Search this workspace</label>
        <div className="group flex h-9 items-center gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 transition-colors focus-within:border-[var(--accent-solid)]">
          <Search size={15} className="shrink-0 text-[var(--text-tertiary)]" aria-hidden />
          <input
            id="mw-search"
            type="search"
            placeholder="Search people, records and reports…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <kbd className="hidden items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] lg:inline-flex">
            <Command size={10} aria-hidden /> K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="relative rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
          aria-label="Notifications, 5 unread"
        >
          <Bell size={18} aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--status-error-solid)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--bg-surface)]">
            5
          </span>
        </button>
        <button type="button" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-[var(--bg-subtle)]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[13px] font-bold text-[var(--accent-fg-strong)]">PN</span>
          <span className="hidden text-[13px] font-semibold text-[var(--text-primary)] lg:block">Priya Nair</span>
          <ChevronDown size={15} className="text-[var(--text-tertiary)]" aria-hidden />
        </button>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export function ModuleWorkspace() {
  const reduce = useReducedMotion()
  const [moduleKey, setModuleKey] = useState<string>('people')
  const [tabState, setTabState] = useState<{ index: number; dir: number }>({ index: 0, dir: 0 })

  const mod = useMemo(() => MODULES.find(m => m.key === moduleKey) ?? MODULES[0], [moduleKey])
  const tab = mod.tabs[Math.min(tabState.index, mod.tabs.length - 1)]

  const selectModule = (key: string) => {
    if (key === moduleKey) return
    setModuleKey(key)
    setTabState({ index: 0, dir: 0 })
  }

  // Direction-aware: the panel slides in from whichever side the new tab sits on.
  const selectTab = (index: number) => {
    setTabState(prev => (index === prev.index ? prev : { index, dir: index > prev.index ? 1 : -1 }))
  }

  const variants = {
    enter: (dir: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40 }),
    center: reduce ? { opacity: 1 } : { opacity: 1, x: 0 },
    exit: (dir: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40 }),
  }

  return (
    <div className="mw-scope flex h-screen overflow-hidden bg-[var(--bg-base)] font-sans text-[var(--text-primary)]">
      <style>{CHART_TOKENS}</style>

      <IconRail activeKey={mod.key} onSelect={selectModule} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar moduleLabel={mod.title} />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
            {/* Sub-tabs — selecting one swaps the panel below in place, no route change */}
            <HrTabs
              tabs={mod.tabs.map((t) => ({ key: t.key, label: t.label }))}
              active={tab.key}
              onChange={(k) => selectTab(mod.tabs.findIndex((t) => t.key === k))}
            />
            <AnimatePresence mode="wait" custom={tabState.dir} initial={false}>
              <motion.div
                key={`${mod.key}:${tab.key}`}
                custom={tabState.dir}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: reduce ? 0.15 : 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <HrTabPanel tabKey={tab.key}>
                  <Panel mod={mod} tab={tab} />
                </HrTabPanel>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  )
}

export default ModuleWorkspace
