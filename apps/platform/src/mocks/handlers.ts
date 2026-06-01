import { http, HttpResponse } from 'msw'

const MOCK_TOKEN = 'mock-access-token'

export const handlers = [
  // ── POST /api/v1/auth/login/:subdomain ───────────────────────────────────
  http.post('/api/v1/auth/login/:subdomain', () =>
    HttpResponse.json({ accessToken: MOCK_TOKEN, refreshToken: 'mock-refresh' })
  ),

  // ── POST /api/v1/auth/login/request-otp ─────────────────────────────────
  http.post('/api/v1/auth/login/request-otp', () =>
    HttpResponse.json({ message: 'OTP sent' })
  ),

  // ── POST /api/v1/auth/login/otp ─────────────────────────────────────────
  http.post('/api/v1/auth/login/otp', () =>
    HttpResponse.json({ accessToken: MOCK_TOKEN })
  ),

  // ── GET /api/v1/auth/me ──────────────────────────────────────────────────
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({
      user: {
        id: 'usr-mock-001',
        email: 'admin@unifiedtree.demo',
        firstName: 'Admin',
        lastName: 'User',
        roles: ['HR_ADMIN'],
      },
      tenant: {
        id: 'ten-mock-001',
        slug: 'demo',
        displayName: 'Demo Corp',
        contactEmail: 'admin@unifiedtree.demo',
        status: 'ACTIVE',
        planType: 'PROFESSIONAL',
      },
      roles: ['HR_ADMIN'],
      permissions: [
        { code: 'hrms.employee.read',         scope: 'ORG' },
        { code: 'hrms.employee.write',        scope: 'ORG' },
        { code: 'hrms.employee.profile.read', scope: 'ORG' },
        { code: 'hrms.leave.read',            scope: 'ORG' },
        { code: 'hrms.leave.approve.l1',      scope: 'BRANCH' },
        { code: 'hrms.ess.read',              scope: 'SELF' },
        { code: 'hrms.ess.write',             scope: 'SELF' },
        { code: 'hrms.department.read',       scope: 'ORG' },
        { code: 'hrms.branch.read',           scope: 'ORG' },
      ],
      modules: [
        { key: 'hrms',      displayName: 'HRMS',       enabled: true  },
        { key: 'payroll',   displayName: 'Payroll',    enabled: false },
        { key: 'crm',       displayName: 'CRM',        enabled: false },
        { key: 'accounts',  displayName: 'Accounts',   enabled: false },
        { key: 'projects',  displayName: 'Projects',   enabled: false },
        { key: 'helpdesk',  displayName: 'Helpdesk',   enabled: false },
        { key: 'inventory', displayName: 'Inventory',  enabled: false },
      ],
      scopes: {
        branches: [],
        departments: [],
        directReports: [],
      },
    })
  ),

  // ── GET /api/v1/hrms/employees ───────────────────────────────────────────
  http.get('/api/v1/hrms/employees', () =>
    HttpResponse.json({
      content: [
        { id: 'emp-001', employeeCode: 'EMP001', firstName: 'Alice', lastName: 'Sharma',
          email: 'alice@demo.com', employmentStatus: 'ACTIVE', dateOfJoining: '2024-01-15' },
        { id: 'emp-002', employeeCode: 'EMP002', firstName: 'Bob',   lastName: 'Verma',
          email: 'bob@demo.com',   employmentStatus: 'ACTIVE', dateOfJoining: '2024-03-01' },
        { id: 'emp-003', employeeCode: 'EMP003', firstName: 'Carol', lastName: 'Nair',
          email: 'carol@demo.com', employmentStatus: 'PROBATION', dateOfJoining: '2025-01-10' },
      ],
      totalElements: 3,
      totalPages: 1,
      number: 0,
      size: 20,
    })
  ),
]
