export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED' | 'CONTRACT' | 'PROBATION'
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY'
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export type LeaveType =
  | 'ANNUAL'
  | 'SICK'
  | 'MATERNITY'
  | 'PATERNITY'
  | 'UNPAID'
  | 'EMERGENCY'
  | 'OTHER'
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN'
export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEKEND'
  | 'REMOTE'
export type PayrollStatus = 'DRAFT' | 'PENDING' | 'PROCESSED' | 'PAID' | 'CANCELLED'

export interface Employee {
  id: string
  tenantId: string
  employeeCode: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone?: string
  gender?: Gender
  dateOfBirth?: string
  department: string
  departmentId: string
  jobTitle: string
  managerId?: string
  managerName?: string
  employmentType: EmploymentType
  status: EmploymentStatus
  startDate: string
  endDate?: string
  salary?: number
  currency?: string
  avatarUrl?: string
  address?: string
  city?: string
  country?: string
  emergencyContact?: {
    name: string
    phone: string
    relationship: string
  }
  createdAt: string
  updatedAt: string
}

export interface Department {
  id: string
  tenantId: string
  name: string
  code: string
  managerId?: string
  managerName?: string
  headcount: number
  parentId?: string
  budget?: number
  createdAt: string
}

export interface AttendanceRecord {
  id: string
  tenantId: string
  employeeId: string
  employeeName: string
  date: string
  checkIn?: string
  checkOut?: string
  hoursWorked?: number
  status: AttendanceStatus
  notes?: string
  location?: { lat: number; lng: number }
  createdAt: string
}

export interface LeaveBalance {
  employeeId: string
  year: number
  annual: { allocated: number; used: number; remaining: number }
  sick: { allocated: number; used: number; remaining: number }
  unpaid: { used: number }
}

export interface LeaveRequest {
  id: string
  tenantId: string
  employeeId: string
  employeeName: string
  type: LeaveType
  status: LeaveStatus
  startDate: string
  endDate: string
  days: number
  reason: string
  approverId?: string
  approverName?: string
  approvedAt?: string
  rejectionReason?: string
  createdAt: string
}

export interface PayrollRecord {
  id: string
  tenantId: string
  employeeId: string
  employeeName: string
  period: string
  grossSalary: number
  basicSalary: number
  allowances: number
  deductions: number
  taxAmount: number
  netSalary: number
  currency: string
  status: PayrollStatus
  processedAt?: string
  paidAt?: string
  paymentMethod?: string
  createdAt: string
}

export interface CreateEmployeeRequest {
  firstName: string
  lastName: string
  email: string
  phone?: string
  gender?: Gender
  dateOfBirth?: string
  departmentId: string
  jobTitle: string
  managerId?: string
  employmentType: EmploymentType
  startDate: string
  salary?: number
  currency?: string
}

export interface CreateLeaveRequest {
  employeeId: string
  type: LeaveType
  startDate: string
  endDate: string
  reason: string
}
