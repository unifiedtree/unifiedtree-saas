#!/usr/bin/env node
/**
 * ERP Module Generator
 * Usage: node scripts/generate-module.js
 *        — or — pnpm new-module
 *
 * Scaffolds a new ERP module under apps/platform/src/modules/<moduleKey>/
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`  Created: ${filePath}`)
}

async function main() {
  console.log('\n🏗  ERP Module Generator\n')

  const moduleKey = (await ask('Module key (e.g. inventory): ')).trim().toLowerCase()
  if (!moduleKey) { console.error('Module key is required'); process.exit(1) }

  const displayName = (await ask(`Display name (e.g. Inventory Management): `)).trim()
  const description = (await ask('Short description: ')).trim()
  const category = (await ask('Category (HR/FINANCE/SALES/OPERATIONS/SUPPORT/ANALYTICS): ')).trim().toUpperCase()
  const icon = (await ask('Lucide icon name (e.g. Package): ')).trim() || 'Box'

  rl.close()

  const moduleName = capitalize(moduleKey)
  const baseDir = path.join(process.cwd(), 'apps', 'platform', 'src', 'modules', moduleKey)

  const dirs = [
    baseDir,
    path.join(baseDir, 'pages'),
    path.join(baseDir, 'components'),
    path.join(baseDir, 'hooks'),
  ]
  dirs.forEach(ensureDir)

  // index.ts
  writeFile(
    path.join(baseDir, 'index.ts'),
    `import { ${icon} } from 'lucide-react'

export const ${moduleKey}Module = {
  key: '${moduleKey}',
  displayName: '${displayName}',
  description: '${description}',
  category: '${category}' as const,
  icon: ${icon},
  color: '#6366f1',
  permissions: [
    '${moduleKey}:read',
    '${moduleKey}:create',
    '${moduleKey}:update',
    '${moduleKey}:delete',
  ],
  navItems: [
    {
      label: 'Overview',
      path: '/platform/${moduleKey}',
      iconName: '${icon}',
      sortOrder: 1,
    },
  ],
}

export { ${moduleName}OverviewPage } from './pages/${moduleName}OverviewPage'
`
  )

  // types.ts
  writeFile(
    path.join(baseDir, 'types.ts'),
    `// Local types for the ${displayName} module
// Import shared types from @erp/types and extend as needed

export interface ${moduleName}Item {
  id: string
  tenantId: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Create${moduleName}ItemRequest {
  name: string
}

export interface ${moduleName}Filters {
  search?: string
  status?: string
}
`
  )

  // pages/OverviewPage.tsx
  writeFile(
    path.join(baseDir, 'pages', `${moduleName}OverviewPage.tsx`),
    `import React from 'react'
import { Card, CardHeader, CardTitle, CardDescription, EmptyState } from '@erp/ui-kit'

export const ${moduleName}OverviewPage: React.FC = () => {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">${displayName}</h1>
          <p className="text-slate-400 mt-1">${description}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            The ${displayName} module is ready to be configured.
          </CardDescription>
        </CardHeader>
        <EmptyState
          title="No data yet"
          description="Start by adding your first ${moduleKey} record."
          action={{ label: 'Add Record', onClick: () => {} }}
        />
      </Card>
    </div>
  )
}
`
  )

  // hooks/use${moduleName}.ts
  writeFile(
    path.join(baseDir, 'hooks', `use${moduleName}.ts`),
    `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@erp/sdk'
import type { ${moduleName}Item, Create${moduleName}ItemRequest, ${moduleName}Filters } from '../types'

const QUERY_KEYS = {
  all: (tenantId: string) => ['${moduleKey}', tenantId] as const,
  list: (tenantId: string, filters: ${moduleName}Filters) =>
    ['${moduleKey}', tenantId, 'list', filters] as const,
}

export function use${moduleName}Items(tenantId: string, filters: ${moduleName}Filters = {}) {
  const client = useApi()
  return useQuery({
    queryKey: QUERY_KEYS.list(tenantId, filters),
    queryFn: () =>
      client.get<{ data: ${moduleName}Item[] }>(\`/api/v1/tenants/\${tenantId}/${moduleKey}\`, filters),
    enabled: Boolean(tenantId),
  })
}

export function useCreate${moduleName}Item(tenantId: string) {
  const client = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Create${moduleName}ItemRequest) =>
      client.post<{ data: ${moduleName}Item }>(\`/api/v1/tenants/\${tenantId}/${moduleKey}\`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all(tenantId) })
    },
  })
}
`
  )

  console.log(`\nModule '${moduleKey}' scaffolded successfully!`)
  console.log(`\nNext steps:`)
  console.log(`  1. Register the module in apps/platform/src/modules/index.ts`)
  console.log(`  2. Add the route in apps/platform/src/app/platform/${moduleKey}/page.tsx`)
  console.log(`  3. Add the type to @erp/types if needed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
