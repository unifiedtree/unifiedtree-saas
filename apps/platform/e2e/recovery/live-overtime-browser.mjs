import { chromium, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
/* global process, console */
const record=randomUUID(),tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const sql=q=>execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d',process.env.RECOVERY_DB||'unifiedtree_recovery','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'})
// The fixture day: the 1st of this month (IST), so it is always inside the Overtime tab's window. 77 extra minutes
// is over the 1-hour minimum (DECISIONS 22), so it is overtime.
const day=new Date(Date.now()+5.5*3600_000).toISOString().slice(0,8)+'01'
sql(`INSERT INTO attendance.records(id,tenant_id,employee_id,company_id,attendance_date,check_in_at,check_out_at,overtime_minutes,remarks) VALUES('${record}','${tenant}','22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc','${day}','${day}T04:00:00Z','${day}T14:00:00Z',77,'Isolated browser overtime fixture')`)
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),base=process.env.RECOVERY_APP_URL||'http://demo.localhost:3002'
try {
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('owner@unifiedtree.demo');await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD||'Hrms@12345');await page.locator('button[type=submit]').click();await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:60000});await page.goto(base+'/hrms/shifts?tab=overtime')
 // Waiting for you: the reader's card for that day (+1h 17m); a note, then Approve.
 const card=page.getByRole('article',{name:'Reader User'}).filter({hasText:'+1h 17m'}).first();await card.waitFor({timeout:30000});await card.getByLabel('Note for Reader User').fill('Verified in browser');await card.getByRole('button',{name:'Approve',exact:true}).click();await expect(card).toHaveCount(0,{timeout:15000})
 // This month: the row reads Approved with the reviewer's note, also after a reload.
 const row=page.getByRole('row').filter({hasText:'Reader User'}).filter({hasText:'1h 17m'});await page.getByRole('button',{name:'This month'}).click();await expect(row).toContainText('Approved');await page.reload();await page.getByRole('button',{name:'This month'}).click();await expect(row).toContainText('Approved');await expect(row).toContainText('Verified in browser');console.log('PASS overtime browser approval, reviewer note and persisted reload')
}finally{await browser.close();sql(`DELETE FROM attendance.overtime_decisions WHERE record_id='${record}';DELETE FROM attendance.records WHERE id='${record}' AND attendance_date='${day}'`)}
