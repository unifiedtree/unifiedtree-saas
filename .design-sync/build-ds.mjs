#!/usr/bin/env node
/**
 * design-sync `buildCmd` — produces the ONE stylesheet the design agent renders
 * every design with: .design-sync/ds-package/dist/styles.css
 *
 * The platform's look is Tailwind utilities (ui-kit + hr.tsx) plus the app's
 * own `.ut-*` / `.hr-table` classes, all under the design-system tokens. None
 * of that exists as a shipped stylesheet — it only exists once Tailwind has
 * compiled `apps/platform/src/globals.css` against the app's config, whose
 * `content` globs already cover `packages/ui-kit/src` AND `apps/platform/src`.
 * So this script runs exactly that compile, with the app's own config, and
 * writes the result to a stable path the converter's `cssEntry` can point at.
 *
 * Two small adjustments, both explained inline:
 *  1. globals.css line 1 is `@import '@unifiedtree/design-system/tokens.css'`.
 *     Vite resolves that bare specifier; the Tailwind CLI's postcss-import does
 *     not (it fails in resolve-id). It is rewritten to the relative path — same
 *     file, same bytes.
 *  2. The brand fonts (Plus Jakarta Sans / Inter / JetBrains Mono) are loaded
 *     by a <link> in index.html, so no stylesheet references them. The Google
 *     Fonts `@import url()` is prepended so previews and designs load the real
 *     families instead of falling back (validate reports it as [FONT_REMOTE]).
 *
 * It also (re)creates `ds-package/node_modules` as a junction to
 * apps/platform/node_modules. The converter's .d.ts step resolves @types/react
 * by walking UP from the entry package looking for `node_modules/@types/react`;
 * with pnpm nothing is hoisted to the repo root, so the walk finds nothing,
 * React utility types collapse to `any`, and every ui-kit component whose
 * props extend React.*HTMLAttributes emits an EMPTY props body ([DTS_REACT]).
 * The junction gives the walk a first hit. It is gitignored (`node_modules`),
 * so it has to be recreated per clone — hence here, in the step every sync
 * already has to run first.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const appDir = join(repo, 'apps', 'platform')
const outDir = join(here, 'ds-package', 'dist')
const out = join(outDir, 'styles.css')

const pkgNodeModules = join(here, 'ds-package', 'node_modules')
const appNodeModules = join(appDir, 'node_modules')
if (!existsSync(appNodeModules)) {
  console.error(`build-ds: ${appNodeModules} is missing — run \`pnpm i --frozen-lockfile\` first`)
  process.exit(1)
}
if (!existsSync(pkgNodeModules)) {
  // 'junction' works on Windows without elevated rights; on POSIX it is a plain symlink.
  symlinkSync(appNodeModules, pkgNodeModules, 'junction')
  console.error(`build-ds: linked ${pkgNodeModules} -> ${appNodeModules}`)
} else if (!lstatSync(pkgNodeModules).isSymbolicLink()) {
  console.error(`build-ds: ${pkgNodeModules} exists but is not a link — remove it and rerun`)
  process.exit(1)
}

const GOOGLE_FONTS =
  '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap");\n'

const require = createRequire(join(appDir, 'package.json'))
const tailwindCli = require.resolve('tailwindcss/lib/cli.js')

const globals = readFileSync(join(appDir, 'src', 'globals.css'), 'utf8')
const BARE = "@import '@unifiedtree/design-system/tokens.css';"
if (!globals.includes(BARE)) {
  console.error(`build-ds: expected globals.css to start with ${BARE} — check apps/platform/src/globals.css`)
  process.exit(1)
}
// The temp input lives beside globals.css so any relative url()/import inside
// it resolves exactly as it does for the app. Always removed, even on failure.
const tmpInput = join(appDir, 'src', '.ds-globals.input.css')
writeFileSync(tmpInput, globals.replace(BARE, "@import '../../../packages/design-system/src/tokens.css';"))

try {
  mkdirSync(outDir, { recursive: true })
  execFileSync(process.execPath, [tailwindCli, '-c', 'tailwind.config.js', '-i', 'src/.ds-globals.input.css', '-o', out, '--minify'], {
    cwd: appDir,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const css = readFileSync(out, 'utf8')
  for (const must of ['--accent-fg:', '.ut-card', '.hr-table', '.ut-input', '--font-sans:']) {
    if (!css.includes(must)) {
      console.error(`build-ds: compiled stylesheet is missing "${must}" — the app config or globals.css changed shape`)
      process.exit(1)
    }
  }
  writeFileSync(out, GOOGLE_FONTS + css)
  console.error(`build-ds: wrote ${out} (${statSync(out).size} bytes)`)
} finally {
  if (existsSync(tmpInput)) rmSync(tmpInput)
}
