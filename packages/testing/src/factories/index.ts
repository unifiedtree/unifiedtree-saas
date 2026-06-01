import { v4 as uuid } from 'uuid'

export const employeeFactory = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(),
  employeeCode: `EMP-${Math.floor(Math.random() * 9000) + 1000}`,
  firstName: 'John',
  lastName: 'Doe',
  email: `john.doe.${Math.random().toString(36).slice(2)}@acme.com`,
  department: 'Engineering',
  designation: 'Software Engineer',
  status: 'ACTIVE',
  joinDate: new Date().toISOString().split('T')[0],
  ...overrides,
})

export const tenantFactory = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(),
  name: 'Test Corp',
  subdomain: `test-${Math.random().toString(36).slice(2, 7)}`,
  planType: 'PROFESSIONAL',
  activeModules: ['hrms', 'crm', 'accounts'],
  status: 'ACTIVE',
  ...overrides,
})

export const leadFactory = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(),
  name: 'Acme Corp',
  email: `lead.${Math.random().toString(36).slice(2)}@prospect.com`,
  source: 'WEBSITE',
  status: 'NEW',
  estimatedValue: Math.floor(Math.random() * 50000) + 5000,
  createdAt: new Date().toISOString(),
  ...overrides,
})
