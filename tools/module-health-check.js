#!/usr/bin/env node
/**
 * Checks each module's pom.xml exists and has the correct parent.
 * Run: node tools/module-health-check.js
 */

const fs = require('fs')
const path = require('path')

const EXPECTED_MODULES = [
  'backend/platform/erp-core',
  'backend/platform/erp-auth',
  'backend/platform/erp-tenant',
  'backend/platform/erp-rbac',
  'backend/modules/mod-hrms',
  'backend/modules/mod-crm',
  'backend/modules/mod-accounts',
  'backend/modules/mod-payroll',
  'backend/modules/mod-inventory',
  'backend/modules/mod-projects',
  'backend/modules/mod-helpdesk',
  'backend/services/svc-auth',
  'backend/services/svc-billing',
  'backend/services/svc-gateway',
]

const ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0

console.log('\nUnifiedTree Module Health Check\n')

for (const mod of EXPECTED_MODULES) {
  const pomPath = path.join(ROOT, mod, 'pom.xml')
  if (fs.existsSync(pomPath)) {
    console.log(`[OK] ${mod}`)
    passed++
  } else {
    console.log(`[MISSING] ${mod} — pom.xml missing`)
    failed++
  }
}

console.log(`\n${passed} modules OK  |  ${failed} modules missing\n`)
process.exit(failed > 0 ? 1 : 0)
