"""
Regression guard for the soft-delete revive fix (client bug, 2026-08-30).

Runs the exact flow the client reported -- create -> delete -> create the SAME
thing again -- against LIVE prod for all four org-setup entities that share the
soft-delete + non-partial-unique-index shape:
    Department, Designation, Grade, Employment Type

Before the fix, step 3 returned 422 DUPLICATE_* because archive() only sets
active=false while create()'s exists-check had no active filter. See
DepartmentService.create for the full explanation.

Expected output: all four rows PASS, each "revived same row" (the archived row
is reused so its id -- and every FK pointing at it -- survives).

    python backend/scripts/qa/org-revive-e2e.py

Creates only QA-prefixed rows and deletes them again on the way out.
"""

import json, urllib.request, urllib.error, time, sys
B="https://api.unifiedtree.com"; T="a7aba720-d487-4685-a57f-69a9f6c3551b"

def call(m,p,tok=None,body=None):
    h={"Content-Type":"application/json"}
    if tok: h["Authorization"]=f"Bearer {tok}"
    d=json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{B}/api{p}",data=d,headers=h,method=m),timeout=30) as r:
            raw=r.read(); return r.status,(json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw=e.read().decode(errors="ignore")
        try: return e.code,json.loads(raw)
        except Exception: return e.code,raw[:200]

s,b=call("POST","/v1/canonical-auth/login",body={"tenantId":T,"email":"reviewer@unifiedtree.com","password":"Reviewer@2026"})
tok=b["accessToken"]
s,comps=call("GET","/v1/hrms/companies",tok); cid=comps[0]["id"]
n=int(time.time())

CASES=[
 ("Department",      "/v1/hrms/departments",      {"companyId":cid,"name":f"QA Dept {n}","code":f"QD{n%10000}"}),
 ("Designation",     "/v1/hrms/designations",     {"companyId":cid,"title":f"QA Desig {n}"}),
 ("Grade",           "/v1/hrms/grades",           {"companyId":cid,"name":f"QA Grade {n}","code":f"QG{n%10000}","level":9}),
 ("Employment Type", "/v1/hrms/employment-types", {"companyId":cid,"name":f"QA EmpType {n}","code":f"QE{n%10000}"}),
]

print(f"{'entity':<18}{'create':>8}{'delete':>8}{'re-add':>8}   verdict")
print("-"*62)
allpass=True
for name,path,payload in CASES:
    s1,b1=call("POST",path,tok,payload)
    rid=b1.get("id") if isinstance(b1,dict) else None
    s2,_=call("DELETE",f"{path}/{rid}",tok) if rid else (None,None)
    s3,b3=call("POST",path,tok,payload)
    rid2=b3.get("id") if isinstance(b3,dict) else None
    ok = (s3 is not None and s3<300)
    same = (rid and rid2 and rid==rid2)
    verdict = ("PASS (revived same row)" if same else "PASS (new row)") if ok else f"FAIL {s3} {str(b3)[:70]}"
    if not ok: allpass=False
    print(f"{name:<18}{str(s1):>8}{str(s2):>8}{str(s3):>8}   {verdict}")
    if rid2: call("DELETE",f"{path}/{rid2}",tok)

print("-"*62)
print("ALL FOUR PASS" if allpass else "SOME FAILED — see above")
