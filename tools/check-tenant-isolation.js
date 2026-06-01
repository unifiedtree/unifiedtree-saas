#!/usr/bin/env node
/**
 * Scans backend Java files for repository methods without tenant_id filtering.
 * Prints warnings for queries that may leak cross-tenant data.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../backend')
console.log('\nTenant Isolation Check\n')

try {
  // Look for findAll() without tenant context in repository files
  const result = execSync(
    `grep -r "findAll()" ${ROOT} --include="*.java" -l 2>/dev/null || true`,
    { encoding: 'utf8' }
  )
  const files = result.trim().split('\n').filter(Boolean)

  if (files.length === 0) {
    console.log('[OK] No bare findAll() calls found in repositories')
  } else {
    console.log('[WARN] Files with potential findAll() calls (review for tenant isolation):')
    files.forEach((f) => console.log(`   ${f.replace(ROOT, 'backend')}`))
  }
} catch {
  console.log('Note: grep not available — skipping file scan')
}

console.log('\nTip: All tenant-scoped repos should use findByTenantId() or extend TenantAwareRepository\n')
