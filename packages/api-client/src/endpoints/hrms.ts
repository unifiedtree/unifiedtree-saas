import { apiClient } from '../ApiClient'

export interface Employee {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  department: string
  designation: string
  status: string
  joinDate: string
}

export const hrmsApi = {
  getEmployees: (params?: { page?: number; size?: number; search?: string; department?: string }) =>
    apiClient.get<{ content: Employee[]; totalElements: number }>(
      '/api/v1/hrms/employees',
      params as Record<string, string | number>
    ),

  getEmployee: (id: string) =>
    apiClient.get<Employee>(`/api/v1/hrms/employees/${id}`),

  createEmployee: (data: Partial<Employee>) =>
    apiClient.post<Employee>('/api/v1/hrms/employees', data),

  updateEmployee: (id: string, data: Partial<Employee>) =>
    apiClient.put<Employee>(`/api/v1/hrms/employees/${id}`, data),

  deleteEmployee: (id: string) =>
    apiClient.delete<void>(`/api/v1/hrms/employees/${id}`),

  getLeaveRequests: (params?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/hrms/leave', params),

  getAttendance: (params?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/hrms/attendance', params),

  getPayroll: (params?: Record<string, string | number>) =>
    apiClient.get<Record<string, unknown>>('/api/v1/hrms/payroll', params),
}
