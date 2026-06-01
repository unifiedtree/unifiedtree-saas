#!/usr/bin/env node
/**
 * Generates a new Flyway migration file with the next version number.
 * Usage: node tools/generate-flyway-migration.js "add_user_preferences_table"
 */
const fs = require('fs')
const path = require('path')

const description = process.argv[2]
if (!description) {
  console.error('Usage: node generate-flyway-migration.js <description>')
  process.exit(1)
}

const MIGRATION_DIR = path.resolve(
  __dirname,
  '../backend/app/erp-app/src/main/resources/db/migration'
)

fs.mkdirSync(MIGRATION_DIR, { recursive: true })

const existing = fs.readdirSync(MIGRATION_DIR)
  .filter((f) => f.startsWith('V') && f.endsWith('.sql'))
  .map((f) => parseInt(f.match(/^V(\d+)/)?.[1] ?? '0'))
  .filter((n) => !isNaN(n))

const nextVersion = (Math.max(0, ...existing) + 1).toString().padStart(3, '0')
const slug = description.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
const filename = `V${nextVersion}__${slug}.sql`
const filepath = path.join(MIGRATION_DIR, filename)

const template = `-- Migration: ${filename}
-- Description: ${description}
-- Created: ${new Date().toISOString().split('T')[0]}

-- Add your SQL here
`

fs.writeFileSync(filepath, template)
console.log(`[OK] Created: db/migration/${filename}`)
