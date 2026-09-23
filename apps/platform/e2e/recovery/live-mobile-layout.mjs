import { chromium, expect } from '@playwright/test'
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),base='http://demo.localhost:3002',errors=[]
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('owner@unifiedtree.demo');await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000})
 for(const route of ['/dashboard','/hrms/companies','/hrms/onboarding/instances','/hrms/shifts','/hrms/ess']){await page.goto(base+route);await page.waitForLoadState('networkidle');const size=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));expect(size.document,route+' should not overflow the viewport').toBeLessThanOrEqual(size.viewport+2);console.log('PASS mobile viewport',route)}
 expect(errors).toEqual([])
}finally{await browser.close()}
