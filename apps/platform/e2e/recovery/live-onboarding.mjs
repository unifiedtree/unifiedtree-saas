/* global process, console, fetch */
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const sql = (q) => execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', process.env.RECOVERY_DB || 'unifiedtree_recovery', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const ui = process.env.RECOVERY_UI_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
async function login(email) {
  const response = await fetch(api + '/v1/canonical-auth/login', { method:'POST', headers:{'Content-Type':'application/json','X-Tenant-ID':tenant}, body:JSON.stringify({tenantId:tenant,email,password:process.env.RECOVERY_PASSWORD || 'Hrms@12345'}) })
  assert.equal(response.status,200)
  return (await response.json()).accessToken
}
const owner = await login('owner@unifiedtree.demo')
async function request(path, token=owner) {
  return fetch(api+path,{headers:{Authorization:`Bearer ${token}`,'X-Tenant-ID':tenant}})
}
const company='cccccccc-cccc-cccc-cccc-cccccccccccc'
for(const [resource, seed] of [
  ['departments',{name:'Local QA Operations',code:'QAOPS'}],
  ['branches',{name:'Local QA Office',code:'QAOFF',city:'Hyderabad',country:'India',geoFenceEnforced:false,headquarters:true}],
]) {
  const list=await (await request(`/v1/hrms/${resource}?companyId=${company}`)).json()
  if(!list.some(item=>item.active)) {
    const response=await fetch(api+`/v1/hrms/${resource}`,{method:'POST',headers:{Authorization:`Bearer ${owner}`,'X-Tenant-ID':tenant,'Content-Type':'application/json'},body:JSON.stringify({companyId:company,...seed})})
    assert.ok(response.ok,`Seed ${resource}: ${response.status} ${await response.text()}`)
  }
}
const browser = await chromium.launch({headless:true})
const page = await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
mkdirSync('test-results/recovery',{recursive:true})
const stamp=Date.now()
// Date fields use the shared calendar: open it, then year → month → day.
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December']
async function pickDate(trigger, iso) {
  const [y,m,d]=iso.split('-').map(Number)
  await trigger.click()
  const calendar=page.getByRole('dialog',{name:'Choose date'})
  await calendar.getByRole('button',{name:'Choose year'}).click()
  await calendar.locator(`[role=gridcell][aria-label="${y}"]`).click()
  await calendar.locator(`[role=gridcell][aria-label="${MONTHS[m-1]} ${y}"]`).click()
  await calendar.getByRole('gridcell',{name:new RegExp(`, ${d} ${MONTHS[m-1]} ${y}`)}).click()
  await calendar.waitFor({state:'hidden'})
}
let createdId=''
try {
  await page.goto(ui+'/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill(process.env.RECOVERY_PASSWORD || 'Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url=>!url.pathname.includes('login'))
  await page.goto(ui+'/hrms/onboarding/instances/new')
  await page.locator('#field-fullName input').fill('Local Onboarding QA')
  await page.locator('#field-email input').fill(`onboarding-${stamp}@example.invalid`)
  await page.locator('#field-phone input').fill('9000000000')
  await pickDate(page.locator('#field-dateOfBirth .utc-trigger'),'1995-01-15')
  const next=()=>page.getByRole('button',{name:'Next',exact:true}).click()
  await next()
  async function choose(id) {
    const select=page.locator(`#field-${id} select`)
    await expect.poll(()=>select.locator('option').count()).toBeGreaterThan(1)
    const value=await select.locator('option').evaluateAll(options=>options.find(o=>o.value && !o.disabled)?.value)
    assert.ok(value,`Available ${id}`)
    await select.selectOption(value)
  }
  await choose('departmentId')
  await choose('branchId')
  await page.locator('#field-designationText input, #field-designationId select').waitFor({ state: 'visible' })
  if(await page.locator('#field-designationText input').count()) await page.locator('#field-designationText input').fill('QA Specialist')
  else await choose('designationId')
  await pickDate(page.locator('#field-dateOfJoining .utc-trigger'),'2026-09-22')
  await page.getByRole('textbox', { name: 'Search reporting managers' }).fill('Reader')
  await expect(page.locator('#field-reportingManagerId option[value="22222222-2222-2222-2222-222222222222"]')).toHaveCount(1)
  await page.locator('#field-reportingManagerId select').selectOption('22222222-2222-2222-2222-222222222222')
  await next()
  await next() // Documents can be collected after joining; private storage is separately configured.
  await page.locator('#field-ctcAnnual input').fill('600000')
  await page.locator('#field-accountHolderName input').fill('Local Onboarding QA')
  await choose('bankName')
  await page.locator('#field-accountNumber input').fill('123456789012')
  await page.locator('#field-ifsc input').fill('HDFC0000001')
  await next()
  await next()
  await next()
  await page.getByRole('button',{name:'Add Asset',exact:true}).first().click()
  await page.getByPlaceholder('e.g. Dell Latitude 5450').fill('Local QA Laptop')
  await page.getByPlaceholder('e.g. SN-84213').fill(`QA-${stamp}`)
  await next()
  // People who can give roles get an Access step before Joining (wave 3); the default access is kept.
  if(await page.getByRole('button',{name:'Create Employee',exact:true}).count()===0) await next()
  const createdResponse=page.waitForResponse(r=>r.url().endsWith('/v1/hrms/employees') && r.request().method()==='POST')
  await page.getByRole('button',{name:'Create Employee',exact:true}).click()
  const created=await createdResponse
  assert.ok(created.ok(),`Employee create ${created.status()}`)
  const employee=await created.json()
  createdId=employee.id
  await expect(page.getByText('Benefits, asset issues, selected policies and joining details are saved on the employee profile.')).toBeVisible({timeout:30000})
  await expect(page.getByRole('button',{name:'Go to Employee Profile'})).toBeEnabled()
  const recordResponse=await request(`/v1/hrms/employees/${employee.id}/onboarding-record`)
  assert.equal(recordResponse.status,200)
  const record=await recordResponse.json()
  assert.equal(record.assets[0].serial,`QA-${stamp}`)
  assert.ok(!('accountHolderName' in record.details),'Bank identity belongs in the permission-gated bank profile')
  const protectedField=await fetch(api+`/v1/hrms/employees/${employee.id}/onboarding-record`,{method:'PUT',headers:{Authorization:`Bearer ${owner}`,'X-Tenant-ID':tenant,'Content-Type':'application/json'},body:JSON.stringify({details:{basicSalary:'999'}})})
  assert.equal(protectedField.status,400,'Salary fields cannot be saved into the general HR notes')
  const core=await (await request(`/v1/hrms/employees/${employee.id}`)).json()
  assert.equal(core.probationEndDate,'2027-03-22')
  assert.equal(core.employmentStatus,'PROBATION')
  assert.equal(core.reportingManagerId,'22222222-2222-2222-2222-222222222222')
  const banks=await (await request(`/v1/employees/${employee.id}/profile/bank-accounts`)).json()
  assert.ok(banks.some(b=>b.primary && b.accountNumberLast4==='9012' && b.accountHolderName==='Local Onboarding QA'))
  assert.ok(banks.every(b=>!b.accountNumber),'Full bank account is not returned')
  const structure=await (await request(`/v1/payroll/structures/employee/${employee.id}`)).json()
  assert.equal(Number(structure.ctcAnnual),600000)
  assert.equal(structure.lines.length,4)
  assert.equal(structure.lines.reduce((sum,line)=>sum+Number(line.monthlyAmount),0),50000)
  const reader=await login('reader@unifiedtree.demo')
  assert.equal((await request(`/v1/hrms/employees/${employee.id}/onboarding-record`,reader)).status,403)
  await page.getByRole('button',{name:'Go to Employee Profile'}).click()
  await expect(page.getByRole('heading',{name:'Onboarding record',exact:true})).toBeVisible()
  await expect(page.getByText(`QA-${stamp}`,{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByText(`QA-${stamp}`,{exact:true})).toBeVisible()
  await page.screenshot({path:'test-results/recovery/onboarding-profile-live.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS: eight-step onboarding creates employee, encrypted payroll bank account, four-line salary structure, probation date and HR record; assets survive profile reload; employee role denied HR record')
} catch(error) {
  await page.screenshot({path:'test-results/recovery/onboarding-failure.png',fullPage:true})
  throw error
} finally {
  await browser.close()
  // The hire is a fixture: remove it before other runs (payroll, letters) pick it up.
  if(createdId) {
    const e=createdId
    for(const q of [
      `delete from hrms.onboarding_instances where employee_id='${e}'`,
      `delete from hrms.employee_onboarding_records where employee_id='${e}'`,
      `delete from hrms.asset_allocations where employee_id='${e}'`,
      `delete from payroll.employee_structure_components where structure_id in (select id from payroll.employee_salary_structures where employee_id='${e}')`,
      `delete from payroll.employee_salary_structures where employee_id='${e}'`,
      `delete from leave_mgmt.leave_balances where employee_id='${e}'`,
      `delete from hrms.employees where id='${e}'`,
    ]) { try { sql(q) } catch(err) { console.log('cleanup:', String(err).split(String.fromCharCode(10))[0]) } }
    console.log(`cleanup: removed QA hire ${e}: ${sql(`select count(*) from hrms.employees where id='${e}'`)==='0'}`)
  }
}
