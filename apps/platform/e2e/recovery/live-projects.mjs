import assert from 'node:assert/strict'
const base='http://127.0.0.1:8080/api',tenantId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',companyId='cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers={'Content-Type':'application/json','X-Tenant-ID':tenantId,'X-Tenant-Subdomain':'demo'}
async function call(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
const login=await call('/v1/canonical-auth/login',{tenantId,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});assert.equal(login.status,200);headers.Authorization=`Bearer ${login.data.accessToken}`
const project=await call('/v1/hrms/projects',{companyId,name:`QA project ${Date.now()}`});assert.equal(project.status,200,JSON.stringify(project.data));const id=project.data.id
const task=await call(`/v1/hrms/projects/${id}/tasks`,{title:'Verify database workflow',dueDate:'2026-09-30'});assert.equal(task.status,200,JSON.stringify(task.data))
const early=await call(`/v1/hrms/projects/${id}/status`,{status:'COMPLETED'},'PUT');assert.ok(early.status>=400&&early.status<500)
assert.equal((await call(`/v1/hrms/projects/tasks/${task.data.id}/status`,{status:'DONE'},'PUT')).status,200)
assert.equal((await call(`/v1/hrms/projects/${id}/status`,{status:'COMPLETED'},'PUT')).status,200)
const closed=await call(`/v1/hrms/projects/${id}/tasks`,{title:'Should fail'});assert.ok(closed.status>=400&&closed.status<500)
const list=await call(`/v1/hrms/projects?companyId=${companyId}`);assert.equal(list.data.find(p=>p.id===id).completed,1)
console.log('PASS project creation, task completion, early-close rejection, closed-project protection, persisted counts')
