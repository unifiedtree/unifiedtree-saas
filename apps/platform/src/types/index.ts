export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  avatar?: string
  role: string
  permissions: string[]
}

export interface Tenant {
  id: string
  name: string
  subdomain: string
  planType: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
  activeModules: string[]
  logoUrl?: string
  industry?: string
}

export interface NavItem {
  key: string
  label: string
  icon: string
  path: string
  moduleRequired?: string
  children?: NavItem[]
  badge?: number
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'success' | 'warning' | 'error' | 'info'
  isRead: boolean
  createdAt: string
  link?: string
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
}

export interface Employee {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  department: string
  designation: string
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED'
  joinDate: string
  avatar?: string
  phone?: string
  salary?: number
}

export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  source: string
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'CONVERTED' | 'LOST'
  estimatedValue?: number
  createdAt: string
  assignedTo?: string
}

export interface Deal {
  id: string
  title: string
  customerName: string
  value: number
  stage: 'PROSPECTING' | 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'CLOSED_WON' | 'CLOSED_LOST'
  probability: number
  expectedCloseDate: string
  assignedTo: string
}

export interface Invoice {
  id: string
  invoiceNumber: string
  customerName: string
  amount: number
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  issueDate: string
  dueDate: string
  paidDate?: string
}

export interface Ticket {
  id: string
  ticketNumber: string
  subject: string
  requesterName: string
  requesterEmail: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category: string
  assignedTo?: string
  createdAt: string
  resolvedAt?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  startDate: string
  dueDate: string
  progress: number
  teamSize: number
  tasksTotal: number
  tasksCompleted: number
}
