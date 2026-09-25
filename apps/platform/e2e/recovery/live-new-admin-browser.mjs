import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
const sql=(q)=>execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d','unifiedtree_recovery','-v','ON_ERROR_STOP=1','-Atc',q],{env:{...process.env,PGPASSWORD:'postgres'}}).toString().trim()
const base='http://demo.localhost:3002'
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
async function login(email){await page.goto(base+'/login');await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000})}
try{
 await login('owner@unifiedtree.demo')
 await page.goto(base+'/hrms/learning');await page.locator('[aria-label="Learning views"]').getByRole('button',{name:/^Certifications/}).click();await page.getByLabel('Find employee').fill('Admin');await page.getByRole('button',{name:/Admin User/}).click()
 const skill=`UI certificate ${Date.now()}`
 await page.getByLabel('Skill name',{exact:true}).fill(skill);await page.getByLabel('Certification name',{exact:true}).fill('Verified certificate');await page.getByLabel('Certified on',{exact:true}).fill('2026-01-01');await page.getByLabel('Certification expiry').fill('2026-12-31');await page.getByRole('button',{name:'Save',exact:true}).click()
 await expect(page.getByRole('row').filter({hasText:skill})).toBeVisible();await page.reload();await page.locator('[aria-label="Learning views"]').getByRole('button',{name:/^Certifications/}).click();await page.getByLabel('Find employee').fill('Admin');await page.getByRole('button',{name:/Admin User/}).click();await expect(page.getByRole('row').filter({hasText:skill})).toContainText('2026')
 console.log('PASS certification browser save and persisted reload')
 // Branch geofence editing moved into the branch drawer on /hrms/companies; live-design-companies.mjs covers it.
 await page.goto(base+'/dashboard');await page.getByRole('button',{name:'Manage projects →'}).click();const name=`UI project ${Date.now()}`;await page.getByLabel('New project name',{exact:true}).fill(name);await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByLabel('Task title',{exact:true}).fill('Persisted UI task');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Status for Persisted UI task',{exact:true}).selectOption('DONE');await page.getByLabel('Project status',{exact:true}).selectOption('COMPLETED');await page.reload();await page.getByRole('button',{name:'Manage projects →'}).click();await page.getByLabel('Project',{exact:true}).selectOption({label:name+' · COMPLETED'});await expect(page.getByLabel('Status for Persisted UI task',{exact:true})).toHaveValue('DONE')
 console.log('PASS project/task browser create, completion and reload')
 expect(errors).toEqual([])
}finally{
 await browser.close()
 // Fixtures: the certificate and the project this run created.
 try{sql(`delete from learning_mgmt.employee_skills where skill_name like 'UI certificate %'`);sql(`delete from hrms.project_tasks where project_id in (select id from hrms.projects where name like 'UI project %')`);sql(`delete from hrms.projects where name like 'UI project %'`);console.log('cleanup: removed the QA certificate and project')}catch(e){console.log('cleanup:',String(e).split(String.fromCharCode(10))[0])}
}
