import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const api=process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const foreign=randomUUID(), company=randomUUID(), employee=randomUUID(), document=randomUUID(), kpi=randomUUID()
const marker=`Tenant Isolation QA ${foreign}`
function sql(statement) {
  return execFileSync('C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',['-h','127.0.0.1','-p','55432','-U','postgres','-d','unifiedtree_recovery','-v','ON_ERROR_STOP=1','-q'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']})
}
const response=await fetch(api+'/v1/canonical-auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant-ID':tenant},body:JSON.stringify({tenantId:tenant,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD || 'Hrms@12345'})})
assert.equal(response.status,200)
const token=(await response.json()).accessToken
async function request(path, headerTenant=tenant) {return fetch(api+path,{headers:{Authorization:`Bearer ${token}`,'X-Tenant-ID':headerTenant}})}
try {
  sql(`BEGIN;
    INSERT INTO platform.tenants(id,subdomain,display_name,contact_email,status,plan_type) VALUES('${foreign}','qa-${foreign.slice(0,8)}','${marker}','qa@example.invalid','ACTIVE','ENTERPRISE');
    INSERT INTO org.companies(id,tenant_id,name,created_by,updated_by) VALUES('${company}','${foreign}','${marker}','qa','qa');
    INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,last_name,email,employment_type,employment_status,created_by,updated_by)
      VALUES('${employee}','${foreign}','${company}','FOREIGN-QA','Foreign','Isolation QA','qa@example.invalid','FULL_TIME','ACTIVE','qa','qa');
    INSERT INTO hrms.employee_onboarding_records(tenant_id,employee_id,details) VALUES('${foreign}','${employee}','{"details":{"permanentAddress":"${marker}"}}'::jsonb);
    INSERT INTO document_mgmt.employee_documents(id,tenant_id,employee_id,company_id,title,file_url) VALUES('${document}','${foreign}','${employee}','${company}','${marker}','https://example.invalid/qa.pdf');
    INSERT INTO performance_mgmt.goals(id,tenant_id,employee_id,title,target_value,current_value) VALUES('${kpi}','${foreign}','${employee}','${marker}',100,0);
    COMMIT;`)
  for(const path of [`/v1/hrms/employees/${employee}`,`/v1/hrms/employees/${employee}/onboarding-record`,`/v1/document/documents/${document}`,`/v1/performance/kpis/${kpi}`,`/v1/performance/kpis/${kpi}/history`]) {
    const result=await request(path)
    const body=await result.json()
    assert.ok([403,404].includes(result.status) || (result.status===422 && /NOT_FOUND/.test(body.errorCode)),`Foreign object blocked: ${path} status=${result.status} code=${body.errorCode}`)
    assert.ok(!JSON.stringify(body).includes(marker),'Foreign details must not be returned')
    console.log(`PASS: foreign object denied ${result.status} ${path.split('/').filter(part=>!part.includes('-')).join('/')}`)
  }
  for(const path of [`/v1/hrms/employees?search=${encodeURIComponent(marker)}`,`/v1/performance/kpis?search=${encodeURIComponent(marker)}`,`/v1/document/employee/${employee}`]) {
    const result=await request(path)
    assert.equal(result.status,200)
    const data=await result.json()
    const rows=data.content ?? data.items
    assert.ok(Array.isArray(rows),`Expected paged list for ${path}`)
    assert.equal(rows.length,0,`Foreign list hidden: ${path}`)
  }
  const spoofed=await request('/v1/hrms/employees/'+employee,foreign)
  assert.ok([400,403,404].includes(spoofed.status),`Tenant-header substitution denied: ${spoofed.status}`)
  const search=await (await request('/v1/search?q=Foreign')).json()
  assert.ok(search.employees.every(hit=>hit.id!==employee),'Global search must also hide foreign employee')
  const ownSearch=await (await request('/v1/search?q=Reader')).json()
  assert.ok(ownSearch.employees.some(hit=>hit.id==='22222222-2222-2222-2222-222222222222'))
  const allowed=new Set(['id','displayName','employeeCode','departmentName','jobTitle','profilePhotoUrl'])
  for(const hit of ownSearch.employees) assert.ok(Object.keys(hit).every(key=>allowed.has(key)),'Search excludes private payroll and identity fields')
  assert.equal((await request('/v1/search?q=x')).status,400)
  console.log('PASS: company-owner API reads and lists cannot expose another tenant; substituted tenant header cannot broaden access')
} finally {
  sql(`BEGIN;
    DELETE FROM performance_mgmt.goals WHERE id='${kpi}' AND tenant_id='${foreign}';
    DELETE FROM document_mgmt.employee_documents WHERE id='${document}' AND tenant_id='${foreign}';
    DELETE FROM hrms.employee_onboarding_records WHERE employee_id='${employee}' AND tenant_id='${foreign}';
    DELETE FROM hrms.employees WHERE id='${employee}' AND tenant_id='${foreign}';
    DELETE FROM org.companies WHERE id='${company}' AND tenant_id='${foreign}';
    DELETE FROM platform.tenants WHERE id='${foreign}'; COMMIT;`)
  console.log('Cleaned isolated cross-tenant fixtures')
}
