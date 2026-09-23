import assert from 'node:assert/strict'
const base='http://127.0.0.1:8080/api',tenantId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',companyId='cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers={'Content-Type':'application/json','X-Tenant-ID':tenantId}
async function call(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
const login=await call('/v1/canonical-auth/login',{tenantId,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});assert.equal(login.status,200);headers.Authorization=`Bearer ${login.data.accessToken}`
const stats=await call(`/v1/admin/dashboard/stats?companyId=${companyId}`);assert.equal(stats.status,200,JSON.stringify(stats.data));assert.equal(typeof stats.data.activeEmployees,'number');assert.equal(typeof stats.data.openRoles,'number');assert.ok(stats.data.complianceScore==null||stats.data.complianceScore>=0&&stats.data.complianceScore<=100)
const alerts=await call('/v1/admin/dashboard/alerts');assert.equal(alerts.status,200,JSON.stringify(alerts.data));assert.ok(Array.isArray(alerts.data));console.log('PASS permission-filtered dashboard summary and alerts')
const input={companyId,title:`QA notice ${Date.now()}`,body:'Verified persisted company notice'}
const notice=await call('/v1/admin/dashboard/notices',input);assert.equal(notice.status,200,JSON.stringify(notice.data));const id=notice.data.id
assert.equal((await call(`/v1/admin/dashboard/notices/${id}`,{...input,body:'Updated notice'},'PUT')).status,200)
const list=await call(`/v1/admin/dashboard/notices?companyId=${companyId}`);assert.equal(list.data.content.find(n=>n.id===id).body,'Updated notice')
assert.equal((await call(`/v1/admin/dashboard/notices/${id}`,undefined,'DELETE')).status,200)
assert.ok(!(await call(`/v1/admin/dashboard/notices?companyId=${companyId}`)).data.content.some(n=>n.id===id));console.log('PASS notices create/edit/archive and persistence')
const reader=await call('/v1/canonical-auth/login',{tenantId,email:'reader@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});headers.Authorization=`Bearer ${reader.data.accessToken}`
assert.equal((await call('/v1/onboarding/assets')).status,403);assert.equal((await call('/v1/admin/dashboard/notices',input)).status,403);console.log('PASS employee cannot read company asset inventory or publish notices')
