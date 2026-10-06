// Preload for the regression run: the check-in prompt after sign-in (5 Oct, compulsory) opens
// once per visit for anyone who may punch from the web, and the older live scripts don't know
// about it, so every click behind it times out. This marks the prompt as already shown for the
// visit — the same session-storage mark the app writes itself after it opens once
// (punchPromptRules.ts: `ut.punch-prompt.opened:<userId>` = today in IST).
// The prompt's own behaviour is covered by its own tests; do not use this preload for them.
//
//   NODE_OPTIONS="--import ./e2e/recovery/_skip-punch-prompt.mjs" node e2e/recovery/<test>.mjs
import { chromium } from '@playwright/test'

const markPromptShown = () => {
  const today = () => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const get = (t) => p.find((x) => x.type === t)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  }
  const original = Storage.prototype.getItem
  Storage.prototype.getItem = function (key) {
    if (typeof key === 'string' && key.startsWith('ut.punch-prompt.opened:')) return today()
    return original.call(this, key)
  }
}

const patchContext = async (ctx) => { await ctx.addInitScript(markPromptShown); return ctx }
const patchBrowser = (browser) => {
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...a) => patchContext(await newContext(...a))
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...a) => { const page = await newPage(...a); await page.context().addInitScript(markPromptShown); return page }
  return browser
}
const launch = chromium.launch.bind(chromium)
chromium.launch = async (...a) => patchBrowser(await launch(...a))
const persistent = chromium.launchPersistentContext.bind(chromium)
chromium.launchPersistentContext = async (...a) => patchContext(await persistent(...a))
