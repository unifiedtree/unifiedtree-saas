import { chromium, expect } from '@playwright/test'
const base='http://demo.localhost:3002'
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
async function login(email){await page.goto(base+'/login');await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000})}
try{
 await login('owner@unifiedtree.demo')
 await page.goto(base+'/hrms/learning');await page.getByRole('tab',{name:'Certifications',exact:true}).click();await page.getByRole('button',{name:/Admin User/}).click()
 const skill=`UI certificate ${Date.now()}`
 await page.getByLabel('Skill name',{exact:true}).fill(skill);await page.getByLabel('Certification name',{exact:true}).fill('Verified certificate');await page.getByLabel('Certified on',{exact:true}).fill('2026-01-01');await page.getByLabel('Certification expiry').fill('2026-12-31');await page.getByRole('button',{name:'Save Skill',exact:true}).click()
 await expect(page.getByRole('row').filter({hasText:skill})).toBeVisible();await page.reload();await page.getByRole('tab',{name:'Certifications',exact:true}).click();await page.getByRole('button',{name:/Admin User/}).click();await expect(page.getByRole('row').filter({hasText:skill})).toContainText('2026')
 console.log('PASS certification browser save and persisted reload')
 await page.goto(base+'/hrms/companies');await page.getByLabel('Latitude',{exact:true}).fill('17.385');await page.getByLabel('Longitude',{exact:true}).fill('78.4867');await page.getByLabel('Radius (metres)',{exact:true}).fill('375');await page.getByRole('button',{name:'Save geofence',exact:true}).click();await expect(page.getByText('Branch geofence saved',{exact:true})).toBeVisible();await page.reload();await expect(page.getByLabel('Radius (metres)',{exact:true})).toHaveValue('375')
 console.log('PASS branch geofence browser save and persisted reload')
 await page.goto(base+'/dashboard');const name=`UI project ${Date.now()}`;await page.getByLabel('New project name',{exact:true}).fill(name);await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByLabel('Task title',{exact:true}).fill('Persisted UI task');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Status for Persisted UI task',{exact:true}).selectOption('DONE');await page.getByLabel('Project status',{exact:true}).selectOption('COMPLETED');await page.reload();await page.getByLabel('Project',{exact:true}).selectOption({label:name+' · COMPLETED'});await expect(page.getByLabel('Status for Persisted UI task',{exact:true})).toHaveValue('DONE')
 console.log('PASS project/task browser create, completion and reload')
 expect(errors).toEqual([])
}finally{await browser.close()}
