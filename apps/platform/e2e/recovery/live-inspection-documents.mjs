import assert from 'node:assert/strict'
import fs from 'node:fs'
const base='http://127.0.0.1:8080/api', tenantId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', companyId='cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers={'Content-Type':'application/json','X-Tenant-ID':tenantId,'X-Tenant-Subdomain':'demo'}
async function call(path,method='GET',body,anonymous=false){const r=await fetch(base+path,{method,headers:anonymous?{'Content-Type':'application/json'}:headers,body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()}}
const login=await call('/v1/canonical-auth/login','POST',{tenantId,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'});assert.equal(login.status,200);headers.Authorization=`Bearer ${login.data.accessToken}`
const offers=await call('/v1/hiring/offers?size=1');const pdfResponse=await fetch(base+`/v1/hiring/offers/${offers.data.content[0].id}/pdf`,{headers});assert.equal(pdfResponse.status,200);const pdf=Buffer.from(await pdfResponse.arrayBuffer())
fs.mkdirSync('test-results/recovery',{recursive:true});fs.writeFileSync('test-results/recovery/inspection-fixture.pdf',pdf)
async function session(){const c=await call('/v1/compliance/inspector-sessions','POST',{companyId,inspectorName:'Document inspector',purpose:'Document isolation verification',expiresAt:new Date(Date.now()+3600000).toISOString()});assert.equal(c.status,201);const link=await call(`/v1/compliance/inspector-sessions/${c.data.id}/link`,'POST');assert.equal(link.status,200);return{id:c.data.id,token:link.data.token}}
const one=await session(),two=await session()
async function upload(bytes){const form=new FormData();form.append('title','Approved filing evidence');form.append('file',new Blob([bytes],{type:'application/pdf'}),'evidence.pdf');const r=await fetch(base+`/v1/compliance/inspector-sessions/${one.id}/documents`,{method:'POST',headers:{Authorization:headers.Authorization,'X-Tenant-ID':tenantId},body:form});return{status:r.status,data:await r.json()}}
const invalid=await upload('not a PDF');assert.equal(invalid.status,422)
const added=await upload(pdf);assert.equal(added.status,201,JSON.stringify(added.data))
const view=await call('/v1/public/inspector-view','POST',{token:one.token},true);assert.equal(view.status,200);assert.equal(view.data.documents[0].id,added.data.id)
async function download(token,id){return fetch(base+'/v1/public/inspector-view/document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,id})})}
const read=await download(one.token,added.data.id);assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await read.arrayBuffer()),pdf)
const foreign=await download(two.token,added.data.id);assert.equal(foreign.status,422)
const removed=await fetch(base+`/v1/compliance/inspector-sessions/${one.id}/documents/${added.data.id}`,{method:'DELETE',headers});assert.equal(removed.status,200)
assert.equal((await download(one.token,added.data.id)).status,422)
const second=await upload(pdf);assert.equal(second.status,201)
await call(`/v1/compliance/inspector-sessions/${one.id}/revoke`,'POST');assert.equal((await download(one.token,second.data.id)).status,422)
await call(`/v1/compliance/inspector-sessions/${two.id}/revoke`,'POST')
console.log('PASS inspector PDF upload, exact-byte download, cross-session denial, unshare, revocation and file validation')
