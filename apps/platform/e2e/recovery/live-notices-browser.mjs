import { chromium, expect } from '@playwright/test'
// Company notices on the admin dashboard, in the browser: create, reload, edit and archive (the redesign puts
// Edit / Archive in the notice panel that a notice chip opens). Cleans up after itself.
//   RECOVERY_APP_URL=http://demo.localhost:3131 node e2e/recovery/live-notices-browser.mjs
const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}})
try {
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('owner@unifiedtree.demo');await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000});await page.goto(base+'/dashboard')
 // Company summary moved into the cards (AUDIT §5.5): active employees are the Total employees note.
 const total=page.getByRole('button',{name:/Total employees/i}).first();await expect(total).toBeVisible({timeout:20000});await expect(total.locator('.uk-stat__note')).toContainText(' active',{timeout:20000})
 await page.getByRole('button',{name:'Add notice',exact:true}).click();const name=`Browser notice ${Date.now()}`;const form=page.getByRole('dialog',{name:'New notice'});await form.getByLabel('Notice title',{exact:true}).fill(name);await form.getByLabel('Notice message',{exact:true}).fill('Company announcement for browser verification');await form.getByRole('button',{name:'Save notice',exact:true}).click()
 const chip=page.getByRole('button',{name:new RegExp('^'+name+'\\.')});await expect(chip).toBeVisible();await page.reload();await expect(chip).toBeVisible({timeout:20000})
 await chip.click();const panel=page.getByRole('dialog',{name});await expect(panel.getByRole('heading',{name,exact:true})).toBeVisible();await panel.getByRole('button',{name:'Edit notice',exact:true}).click();const edit=page.getByRole('dialog',{name:'Edit notice'});await edit.getByLabel('Notice message',{exact:true}).fill('Updated persisted announcement');await edit.getByRole('button',{name:'Save notice',exact:true}).click();await expect(edit).toHaveCount(0)
 await chip.click();await expect(page.getByRole('dialog',{name}).locator('article')).toContainText('Updated persisted announcement');await page.getByRole('dialog',{name}).getByRole('button',{name:'Archive notice',exact:true}).click();await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button',{name:'Archive',exact:true}).click();await expect(chip).toHaveCount(0)
 console.log('PASS company notices browser create, reload, edit and archive')
 // The Active employees tile (→ directory filtered to ACTIVE) is gone in the redesign; Total employees opens the directory.
 await total.click();await expect(page).toHaveURL(/\/hrms\/employees/);console.log('PASS total-employees dashboard drilldown opens the directory')
 await page.goto(base+'/payroll');await expect(page).toHaveURL(/hrms\/payroll-dashboard/);await expect(page.getByRole('heading',{name:'Payroll Dashboard',exact:true})).toBeVisible();console.log('PASS legacy payroll route reaches working dashboard')
}catch(e){console.log('FAIL',String(e.message||e).split('\n')[0]);console.log('FORMS',await page.locator('form').allTextContents().catch(()=>[]));process.exitCode=1}finally{await browser.close()}
