import assert from 'node:assert/strict'
const base = 'http://127.0.0.1:8080/api', tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const headers = { 'Content-Type':'application/json', 'X-Tenant-ID':tenantId, 'X-Tenant-Subdomain':'demo' }
async function call(path, method='GET', body) {
  const r = await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})
  return { status:r.status, data:await r.json() }
}
const login=await call('/v1/canonical-auth/login','POST',{tenantId,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'})
assert.equal(login.status,200); headers.Authorization=`Bearer ${login.data.accessToken}`
const recipient=`offer-${Date.now()}@example.test`
const body={companyId:'cccccccc-cccc-cccc-cccc-cccccccccccc',candidateName:'Local email verification',roleTitle:'Engineer',offeredCtc:600000,notes:'SECRET_NOT_FOR_EMAIL'}
const created=await call('/v1/hiring/offers','POST',body); assert.equal(created.status,201); const id=created.data.id
const missing=await call(`/v1/hiring/offers/${id}/email`,'POST',{recipient});assert.equal(missing.status,422)
const edit=await call(`/v1/hiring/offers/${id}`,'PUT',{...body,offerTerms:'Approved local test terms'});assert.equal(edit.status,200)
const results=await Promise.all([call(`/v1/hiring/offers/${id}/email`,'POST',{recipient}),call(`/v1/hiring/offers/${id}/email`,'POST',{recipient})])
for(const r of results){assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.status,'SENT');assert.ok(r.data.emailSubmittedAt);assert.equal(r.data.emailRecipient,recipient)}
const messages=await (await fetch('http://127.0.0.1:18025/messages')).json()
const matching=messages.filter(m=>m.to.includes(recipient));assert.equal(matching.length,1,'Repeated concurrent request sends once')
const mime=await (await fetch(`http://127.0.0.1:18025/messages/${matching[0].id}`)).text()
assert.match(mime,/application\/pdf/);assert.match(mime,/Approved local test terms/);assert.ok(!mime.includes('SECRET_NOT_FOR_EMAIL'))
const retry=await call(`/v1/hiring/offers/${id}/email`,'POST',{recipient:'other@example.test'});assert.equal(retry.status,422)
const listed=await call('/v1/hiring/offers?size=20');assert.equal(listed.data.content.find(o=>o.id===id).emailRecipient,recipient)
await call(`/v1/hiring/offers/${id}/status`,'POST',{status:'WITHDRAWN'})
console.log('PASS local SMTP submission with PDF, duplicate suppression, saved recipient/timestamp, terms validation and private note exclusion')
