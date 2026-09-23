import assert from 'node:assert/strict'
const base='http://127.0.0.1:8080/api',tenantId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const results=await Promise.all(Array.from({length:3},async()=>{
 const response=await fetch(base+'/v1/canonical-auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant-ID':tenantId},body:JSON.stringify({tenantId,email:'owner@unifiedtree.demo',password:process.env.RECOVERY_PASSWORD||'Hrms@12345'})});const data=await response.json();assert.equal(response.status,200,`Concurrent login failed: ${response.status} ${data.errorCode||''}`);return data.accessToken
}))
for(const token of results){const me=await fetch(base+'/v1/canonical-auth/me',{headers:{Authorization:`Bearer ${token}`,'X-Tenant-ID':tenantId}});assert.equal(me.status,200)}
console.log('PASS three simultaneous sign-ins for the same account and authenticated session reads')
