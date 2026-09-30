// Phone width (390): no page scrolls sideways, and the navigation drawer (the rail expanded plus More)
// opens and closes without widening the page.
//   RECOVERY_APP_URL=http://demo.localhost:3115 node e2e/recovery/live-mobile-layout.mjs
/* global console, process, document */
import { chromium, expect } from '@playwright/test'
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),base=process.env.RECOVERY_APP_URL||'http://demo.localhost:3002',errors=[]
page.on('pageerror',e=>errors.push(e.message))
const overflow=()=>page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}))
try{
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('owner@unifiedtree.demo');await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000})
 for(const route of ['/dashboard','/hrms/companies','/hrms/onboarding/instances','/hrms/shifts','/hrms/ess']){await page.goto(base+route);await page.waitForLoadState('networkidle');const size=await overflow();expect(size.document,route+' should not overflow the viewport').toBeLessThanOrEqual(size.viewport+2);console.log('PASS mobile viewport',route)}
 await page.getByRole('button',{name:'Open navigation'}).click()
 const drawer=page.getByRole('dialog',{name:'Navigation'})
 await expect(drawer).toBeVisible()
 await expect(drawer.getByRole('navigation',{name:'Primary'})).toBeVisible()
 const open=await overflow();expect(open.document,'the open drawer should not widen the page').toBeLessThanOrEqual(open.viewport+2)
 await page.getByRole('button',{name:'Close navigation'}).click()
 await expect(drawer).toHaveCount(0)
 console.log('PASS mobile drawer opens and closes without sideways scroll')
 expect(errors).toEqual([])
}finally{await browser.close()}
