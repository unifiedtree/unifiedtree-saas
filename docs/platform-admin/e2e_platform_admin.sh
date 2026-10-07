#!/usr/bin/env bash
# End-to-end acceptance tests for the UnifiedTree admin console API and the
# Marketing SSO / internal API. LOCAL ONLY: run against a backend started on a
# disposable database seeded with db/dev-seed + e2e_fixtures.sql (see TEST_RESULTS.md).
# Never point this at production — it creates invoices, price versions and overrides.
#
#   BASE=http://127.0.0.1:8085/api SERVICE_TOKEN=... OPS_EMAIL=... OPS_PASSWORD=... ./e2e_platform_admin.sh
set -u
BASE="${BASE:-http://127.0.0.1:8085/api}"
case "$BASE" in *unifiedtree.com*) echo "Refusing to run against a unifiedtree.com host"; exit 2;; esac

PASS=0; FAIL=0
TENANT_DEMO=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
TENANT_BETA=bbbbbbbb-0000-0000-0000-00000000000b
CO_A1=cccccccc-cccc-cccc-cccc-cccccccccccc     # has Marketing
CO_A2=dddddddd-0000-0000-0000-0000000000a2     # same workspace, no Marketing
CO_B1=b1b1b1b1-0000-0000-0000-0000000000b1     # other workspace
PAYMENT=9a900000-0000-0000-0000-000000000001

ok()   { PASS=$((PASS+1)); printf "  PASS  %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  FAIL  %s  -- %s\n" "$1" "$2"; }
# req METHOD PATH [BODY] [AUTH_HEADER] -> sets CODE and BODY_OUT
req() {
  local m="$1" p="$2" b="${3:-}" h="${4:-}"
  local args=(-s -o /tmp/e2e_body.$$ -w '%{http_code}' -X "$m" "$BASE$p" -H 'Content-Type: application/json')
  [ -n "$h" ] && args+=(-H "$h")
  [ -n "$b" ] && args+=(--data "$b")
  CODE=$(curl "${args[@]}")
  BODY_OUT=$(cat /tmp/e2e_body.$$ 2>/dev/null); rm -f /tmp/e2e_body.$$
}
expect() { # expect LABEL CODE [python-assertion-on-j]
  local label="$1" want="$2" check="${3:-True}"
  if [ "$CODE" != "$want" ]; then bad "$label" "HTTP $CODE (want $want): ${BODY_OUT:0:200}"; return; fi
  if printf '%s' "$BODY_OUT" | python -c "
import json,sys
raw=sys.stdin.read()
try: j=json.loads(raw)
except Exception: j=None
sys.exit(0 if ($check) else 1)" 2>/dev/null; then ok "$label"; else bad "$label" "assertion failed: $check :: ${BODY_OUT:0:240}"; fi
}
jget() { printf '%s' "$BODY_OUT" | python -c "import json,sys; j=json.load(sys.stdin); print($1)"; }

echo "== Platform admin authentication (TEST 1, 11) =="
req POST /v1/platform/auth/login "{\"email\":\"$OPS_EMAIL\",\"password\":\"$OPS_PASSWORD\"}"
expect "operator signs in with UnifiedTree authority" 200 "j and j.get('accessToken')"
OPS="Authorization: Bearer $(jget "j['accessToken']")"
req GET /v1/platform/admin/me "" "$OPS"
expect "/me shows the platform role and the new console permissions" 200 \
  "'PLATFORM_SUPER_ADMIN' in j['roles'] and 'platform.company.read' in j['permissions'] and 'platform.billing.manage' in j['permissions']"
req GET /v1/platform/admin/workspaces
expect "no token -> 401" 401
req POST /v1/canonical-auth/login '{"email":"admin@unifiedtree.demo","password":"Hrms@12345"}' "X-Tenant-Subdomain: demo"
WS_TOKEN="Authorization: Bearer $(jget "j.get('accessToken','')")"
req GET /v1/platform/admin/workspaces "" "$WS_TOKEN"
expect "a WORKSPACE owner's token cannot use the platform console -> 403" 403

echo "== Directory from Java/PostgreSQL (TEST 2, 3) =="
req GET "/v1/platform/admin/workspaces?size=50" "" "$OPS"
expect "workspaces list includes demo and beta" 200 \
  "set(w['subdomain'] for w in j['content']) >= {'demo','beta'}"
expect "company counts read through each workspace's RLS (demo=2, beta=1)" 200 \
  "{w['subdomain']:w['companyCount'] for w in j['content']}.get('demo')==2 and {w['subdomain']:w['companyCount'] for w in j['content']}.get('beta')==1"
req GET "/v1/platform/admin/companies?size=50" "" "$OPS"
expect "companies across workspaces = 3" 200 "j['totalElements']==3"
expect "A1 has Marketing (whatsapp), A2 does not (TEST 7)" 200 \
  "[c for c in j['content'] if c['id']=='$CO_A1'][0]['products'].count('whatsapp')==1 and 'whatsapp' not in [c for c in j['content'] if c['id']=='$CO_A2'][0]['products']"
req GET "/v1/platform/admin/companies?product=whatsapp" "" "$OPS"
expect "product filter: only A1 has Marketing" 200 "[c['id'] for c in j['content']]==['$CO_A1']"
req GET "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A1" "" "$OPS"
expect "company detail: entitlements + access summary (employees via RLS)" 200 \
  "j['company']['name'] and j['access']['activeEmployees']>0 and any(e['moduleKey']=='whatsapp' and e['entitled'] for e in j['entitlements'])"
req GET "/v1/platform/admin/workspaces/$TENANT_BETA/companies/$CO_A1" "" "$OPS"
expect "company addressed under the WRONG workspace -> 404" 404
req GET "/v1/platform/admin/accounts" "" "$OPS"
expect "accounts with their workspace memberships" 200 \
  "j['totalElements']>=2 and any(m['subdomain']=='demo' for a in j['content'] for m in a['workspaces'])"
req GET "/v1/platform/admin/workspaces/$TENANT_DEMO" "" "$OPS"
expect "workspace detail with companies, members and modules" 200 \
  "len(j['companies'])==2 and len(j['members'])>=2 and j['ownerEmail']=='admin@unifiedtree.demo'"

echo "== Products / plans / prices (TEST 4) =="
req GET /v1/platform/admin/catalog/plans "" "$OPS"
expect "plans come from the existing catalogue, marketing has structured limits" 200 \
  "any(p['key']=='marketing' and p['limits'].get('contacts')==5000 for p in j) and any(p['key']=='hr-employees' for p in j)"
req GET /v1/platform/admin/catalog/modules "" "$OPS"
expect "modules include hrms and whatsapp (Marketing)" 200 "{'hrms','whatsapp'} <= set(m['key'] for m in j)"
req POST /v1/platform/admin/catalog/plans/crm/prices '{"unitPrice":99,"reason":"x"}' "$OPS"
expect "price change without a real reason -> 400" 400
req POST /v1/platform/admin/catalog/plans/crm/prices '{"unitPrice":99,"reason":"Launch price for CRM"}' "$OPS"
expect "price change closes the old version and opens a new one" 200 \
  "j['current']['unitPrice']==99 and j['previous'] and j['previous']['validTo'] and j['plan']['priceInr']==99"
req GET /v1/platform/admin/catalog/plans/crm/prices "" "$OPS"
expect "price history keeps the old price" 200 "len(j)>=2 and sum(1 for v in j if v['current'])==1"
req POST /v1/platform/admin/catalog/plans/crm/prices '{"unitPrice":99,"reason":"Same price again"}' "$OPS"
expect "re-publishing the current price -> 409" 409

echo "== Company entitlements =="
req PUT "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A2/entitlements/whatsapp" '{"status":"ACTIVE","reason":""}' "$OPS"
expect "manual override without a reason -> 400" 400
req PUT "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A2/entitlements/whatsapp" '{"status":"ACTIVE","reason":"Two-week pilot agreed by sales"}' "$OPS"
expect "manual ACTIVE turns Marketing on for A2" 200 "j['entitled'] and j['source']=='MANUAL'"
req DELETE "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A2/entitlements/whatsapp" "" "$OPS"
expect "removing an override without a reason -> 400" 400
req DELETE "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A2/entitlements/whatsapp?reason=Pilot%20ended" "" "$OPS"
expect "removing the override turns it off again" 200 "j['cleared'] and not j['effective']['entitled']"
req PUT "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_B1/entitlements/whatsapp" '{"status":"ACTIVE","reason":"wrong workspace attempt"}' "$OPS"
expect "override for a company under the wrong workspace -> 404" 404

echo "== Billing: subscriptions, payments, invoices =="
req GET /v1/platform/admin/payments "" "$OPS"
expect "payments from platform.payments" 200 "any(p['id']=='$PAYMENT' for p in j['content'])"
req POST "/v1/platform/admin/payments/$PAYMENT/invoice" "" "$OPS"
expect "draft invoice from a captured payment adds up to what was paid" 200 \
  "j['status']=='DRAFT' and abs(float(j['total'])-1180.0)<0.011 and len(j['lines'])==1"
INV=$(jget "j['id']")
req POST "/v1/platform/admin/payments/$PAYMENT/invoice" "" "$OPS"
expect "a payment cannot be invoiced twice -> 409" 409
req POST "/v1/platform/admin/invoices/$INV/issue" "" "$OPS"
expect "issuing before the seller's GST details are set -> 409 (an issued invoice is frozen)" 409
req PUT /v1/platform/admin/settings/billing '{"sellerLegalName":"UnifiedTree Technologies Pvt Ltd","sellerGstin":"29AAACU1234F1Z5","sellerPan":"AAACU1234F","sellerAddress":"Bengaluru","sellerStateCode":"29","sellerEmail":"billing@unifiedtree.test","invoicePrefix":"UTREE","defaultGstRatePct":18,"invoiceDueDays":7}' "$OPS"
expect "a 5-character invoice prefix is refused (GST numbers are at most 16 characters)" 400
req PUT /v1/platform/admin/settings/billing '{"sellerLegalName":"UnifiedTree Technologies Pvt Ltd","sellerGstin":"29AAACU1234F1Z5","sellerPan":"AAACU1234F","sellerAddress":"Bengaluru","sellerStateCode":"29","sellerEmail":"billing@unifiedtree.test","invoicePrefix":"UT","defaultGstRatePct":18,"invoiceDueDays":7}' "$OPS"
expect "seller details saved" 200 "j['sellerGstin']=='29AAACU1234F1Z5' and j['invoicePrefix']=='UT'"
req POST "/v1/platform/admin/invoices/$INV/issue" "" "$OPS"
expect "issuing numbers it PREFIX/yy-yy/nnnnn (<= 16 chars), snapshots billing, marks it PAID" 200 \
  "__import__('re').fullmatch(r'UT/\\d\\d-\\d\\d/\\d{5}', j['invoiceNumber']) and len(j['invoiceNumber'])<=16 and j['status']=='PAID' and j['billingSnapshot']['seller']['gstin']=='29AAACU1234F1Z5' and j['billingSnapshot']['buyer']['workspace']=='demo'"
req POST "/v1/platform/admin/invoices/$INV/issue" "" "$OPS"
expect "issuing twice -> 409" 409
req POST "/v1/platform/admin/invoices/$INV/void" '{"reason":"no"}' "$OPS"
expect "void without a real reason -> 400" 400
req POST "/v1/platform/admin/invoices/$INV/void" '{"reason":"Issued against the wrong company"}' "$OPS"
expect "void with a reason" 200 "j['status']=='VOID' and j['voidReason']"
req POST "/v1/platform/admin/payments/$PAYMENT/invoice" "" "$OPS"
expect "after the void, the payment can be drafted again" 200 "j['status']=='DRAFT'"
INV2=$(jget "j['id']")
req POST "/v1/platform/admin/invoices/$INV2/void" '{"reason":"Drafted with the wrong period"}' "$OPS"
expect "a wrong draft is DISCARDED (it never had a number)" 200 "j['status']=='DISCARDED' and j['invoiceNumber'] is None"
req POST "/v1/platform/admin/payments/$PAYMENT/invoice" "" "$OPS"
expect "after discarding, the payment can be drafted again" 200 "j['status']=='DRAFT'"
req POST /v1/platform/admin/invoices "{\"tenantId\":\"$TENANT_BETA\",\"paymentId\":\"$PAYMENT\",\"lines\":[{\"description\":\"x\",\"unitPrice\":1}]}" "$OPS"
expect "a draft cannot use another workspace's payment -> 400" 400
req GET "/v1/platform/admin/invoices?tenantId=$TENANT_DEMO" "" "$OPS"
expect "invoice list" 200 "j['totalElements']>=1"
req PUT "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A1/billing-profile" '{"gstin":"BAD"}' "$OPS"
expect "billing profile with a malformed GSTIN -> 400" 400
req PUT "/v1/platform/admin/workspaces/$TENANT_DEMO/companies/$CO_A1/billing-profile" '{"legalName":"UnifiedTree Demo Corp Pvt Ltd","gstin":"29ABCDE1234F1Z5","stateCode":"29","billingEmail":"billing@demo.test","city":"Bengaluru"}' "$OPS"
expect "valid billing profile saved" 200 "j['gstin']=='29ABCDE1234F1Z5'"
req GET /v1/platform/admin/subscriptions "" "$OPS"
expect "subscriptions list" 200 "'content' in j"
req GET /v1/platform/admin/settings/billing "" "$OPS"
expect "billing settings: pooled Meta billing is OFF" 200 "j['marketingPooledBillingEnabled'] is False"

echo "== HRMS as a product, dashboard, audit =="
req GET /v1/platform/admin/hrms/workspaces "" "$OPS"
expect "HRMS workspaces with seats used (counted through RLS)" 200 \
  "any(w['subdomain']=='demo' and w['seatsUsed']>0 for w in j)"
req GET /v1/platform/admin/dashboard "" "$OPS"
expect "dashboard: real counts (companies across workspaces = 3)" 200 \
  "j['companies']==3 and j['workspaces']>=2 and j['companiesWithMarketing']==1"
req GET "/v1/platform/admin/audit?size=50" "" "$OPS"
expect "operator changes are in the platform audit trail" 200 \
  "{'PLAN_PRICE_CHANGE','ENTITLEMENT_OVERRIDE','INVOICE_ISSUED','INVOICE_VOIDED'} <= set(e['action'] for e in j['content'])"

echo "== Internal API for Marketing (service token) =="
ST="X-UnifiedTree-Service-Token: $SERVICE_TOKEN"
req GET "/v1/internal/marketing/companies/$CO_A1/entitlement?tenantId=$TENANT_DEMO"
expect "internal API without the service token -> 401" 401
req GET "/v1/inte%72nal/marketing/principals?companyId=$CO_A1"
expect "a percent-encoded path cannot skip the service token (regression)" 401
req GET "/v1/%69nternal/marketing/access?accountId=$CO_A1&tenantId=$TENANT_DEMO&companyId=$CO_A1"
expect "another encoded variant is refused too" 401
req GET "/v1/internal/marketing/companies/$CO_A1/entitlement?tenantId=$TENANT_DEMO" "" "X-UnifiedTree-Service-Token: wrong-wrong-wrong-wrong-wrong-wrong"
expect "internal API with a wrong token -> 401" 401
req GET "/v1/internal/marketing/companies/$CO_A1/entitlement?tenantId=$TENANT_DEMO" "" "$ST"
expect "Marketing entitlement decided by UnifiedTree (TEST 8): A1 entitled on plan marketing with its limits" 200 \
  "j['entitled'] and j['planKey']=='marketing' and j['limits']['contacts']==5000 and j['contractVersion']==1 and j['billingMode']=='DIRECT_CUSTOMER'"
req GET "/v1/internal/marketing/companies/$CO_A2/entitlement?tenantId=$TENANT_DEMO" "" "$ST"
expect "A2 not entitled (TEST 7)" 200 "j['entitled'] is False"
req GET "/v1/internal/marketing/companies/$CO_A1/entitlement?tenantId=$TENANT_BETA" "" "$ST"
expect "entitlement asked under the wrong workspace -> 404" 404

echo "== marketing.unifiedtree.com SSO =="
req POST /v1/accounts/auth/login '{"email":"admin@unifiedtree.demo","password":"Hrms@12345"}'
expect "admin signs in to their UnifiedTree account" 200 "j.get('accessToken')"
ADMIN_ACCT="Authorization: Bearer $(jget "j['accessToken']")"
req POST /v1/accounts/auth/login '{"email":"reader@unifiedtree.demo","password":"Hrms@12345"}'
READER_ACCT="Authorization: Bearer $(jget "j['accessToken']")"
req GET /v1/sso/marketing/companies "" "$ADMIN_ACCT"
expect "company chooser: demo workspace, A1 has Marketing, A2 does not" 200 \
  "j[0]['subdomain']=='demo' and {c['companyId']:c['marketingEntitled'] for c in j[0]['companies']}=={'$CO_A1':True,'$CO_A2':False}"
req GET /v1/sso/marketing/companies "" "$READER_ACCT"
expect "reader sees only their home company" 200 "[c['companyId'] for c in j[0]['companies']]==['$CO_A1']"
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A2\"}" "$ADMIN_ACCT"
expect "handoff into a company WITHOUT Marketing -> 403 (TEST 7)" 403 "'MARKETING_NOT_ENTITLED' in raw"
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A2\"}" "$READER_ACCT"
expect "tampered company id the person cannot access -> 403 (TEST 9)" 403 "'COMPANY_ACCESS_DENIED' in raw"
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_BETA\",\"companyId\":\"$CO_B1\"}" "$READER_ACCT"
expect "another workspace's company -> 403" 403 "'NOT_A_MEMBER' in raw"
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$OPS"
expect "a platform-operator token cannot mint a customer handoff -> 403" 403
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$ADMIN_ACCT"
expect "handoff into A1 returns a 60-second ticket" 200 "len(j['ticket'])>=40 and j['expiresAt']"
TICKET=$(jget "j['ticket']")
req POST /v1/internal/marketing/sso/redeem "{\"ticket\":\"$TICKET\"}" "$ST"
expect "Marketing redeems it server-to-server: verified account, workspace, company, admin" 200 \
  "j['email']=='admin@unifiedtree.demo' and j['companyId']=='$CO_A1' and j['marketingAdmin'] and j['entitlement']['entitled']"
req POST /v1/internal/marketing/sso/redeem "{\"ticket\":\"$TICKET\"}" "$ST"
expect "the same ticket cannot be redeemed twice -> 401" 401
req POST /v1/sso/marketing/handoff "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$READER_ACCT"
TICKET2=$(jget "j['ticket']")
req POST /v1/internal/marketing/sso/redeem "{\"ticket\":\"$TICKET2\"}" "$ST"
expect "an employee enters as a member, not as the company's Marketing admin" 200 \
  "j['email']=='reader@unifiedtree.demo' and j['marketingAdmin'] is False"
req GET "/v1/internal/marketing/access?accountId=acc00000-0000-0000-0000-000000000002&tenantId=$TENANT_DEMO&companyId=$CO_A2" "" "$ST"
expect "company switch re-check refuses a company the person cannot access" 403

echo "== Identity map, channels, usage =="
req PUT /v1/internal/marketing/principals "{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"65a1b2c3d4e5f60718293a4b\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$ST"
expect "company owner principal recorded" 200 "j['companyOwnerLegacyUserId']=='65a1b2c3d4e5f60718293a4b'"
req PUT /v1/internal/marketing/principals "{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"65a1b2c3d4e5f60718293a4c\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$ST"
expect "a second, different owner for the same company -> 409" 409
req PUT /v1/internal/marketing/principals "{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"65a1b2c3d4e5f60718293a4b\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A2\"}" "$ST"
expect "re-pointing a mapped Marketing user to another company -> 409" 409
req GET "/v1/platform/admin/marketing/identity-map?status=MAPPED&tenantId=$TENANT_DEMO" "" "$OPS"
expect "operator sees the owner mapping" 200 "any(r['legacyMarketingUserId']=='65a1b2c3d4e5f60718293a4b' for r in j['content'])"
MAP_ID=$(jget "[r['id'] for r in j['content'] if r['legacyMarketingUserId']=='65a1b2c3d4e5f60718293a4b'][0]")
req POST "/v1/platform/admin/marketing/identity-map/$MAP_ID/retire" '{"reason":""}' "$OPS"
expect "retiring a mapping without a reason -> 400" 400
req POST "/v1/platform/admin/marketing/identity-map/$MAP_ID/retire" '{"reason":"Marketing database restored; owner user lost"}' "$OPS"
expect "operator retires the owner mapping" 200 "j['status']=='RETIRED'"
req POST "/v1/platform/admin/marketing/identity-map/$MAP_ID/retire" '{"reason":"second attempt"}' "$OPS"
expect "retiring it again -> 409" 409
req PUT /v1/internal/marketing/principals "{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"65a1b2c3d4e5f60718293a4c\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$ST"
expect "after retirement a fresh owner principal can be recorded (recovery path)" 200 "j['companyOwnerLegacyUserId']=='65a1b2c3d4e5f60718293a4c'"
req PUT /v1/internal/marketing/principals "{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"65a1b2c3d4e5f60718293a4b\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\"}" "$ST"
expect "the retired Marketing user is never re-pointed by the service -> 409 PRINCIPAL_HELD" 409 "'PRINCIPAL_HELD' in raw"
req POST /v1/internal/marketing/channels "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\",\"wabaId\":\"104000000000001\",\"displayName\":\"Demo WABA\"}" "$ST"
expect "WABA registered to A1 (DIRECT_CUSTOMER)" 200 "j['billingMode']=='DIRECT_CUSTOMER'"
CH=$(jget "j['id']")
req POST /v1/internal/marketing/channels "{\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A2\",\"wabaId\":\"104000000000001\"}" "$ST"
expect "the same WABA cannot be moved to A2 -> 409" 409
req PUT "/v1/platform/admin/marketing/channels/$CH/billing-mode" '{"billingMode":"UNIFIEDTREE_POOLED"}' "$OPS"
expect "pooled billing refused while Meta approval is absent -> 409" 409 "'POOLED_BILLING_DISABLED' in raw"
USAGE="{\"idempotencyKey\":\"meta:wamid.LOCAL1:conversation\",\"tenantId\":\"$TENANT_DEMO\",\"companyId\":\"$CO_A1\",\"wabaId\":\"104000000000001\",\"usageType\":\"CONVERSATION\",\"category\":\"marketing\",\"market\":\"IN\",\"occurredAt\":\"2026-10-06T10:00:00Z\"}"
req POST /v1/internal/marketing/usage "$USAGE" "$ST"
expect "usage event recorded" 200 "j['recorded'] and not j['duplicate']"
req POST /v1/internal/marketing/usage "$USAGE" "$ST"
expect "the same provider event is not recorded twice (idempotent)" 200 "j['duplicate'] and not j['recorded']"
req GET "/v1/platform/admin/marketing/usage?tenantId=$TENANT_DEMO" "" "$OPS"
expect "usage summary in the admin console" 200 "j['events']==1 and j['pooledBillingEnabled'] is False"
req POST /v1/internal/marketing/audit "{\"tenantId\":\"$TENANT_DEMO\",\"action\":\"PLATFORM_TAMPER\",\"summary\":\"x\"}" "$ST"
expect "Marketing cannot write non-Marketing audit actions -> 400" 400
req POST /v1/internal/marketing/audit "{\"tenantId\":\"$TENANT_DEMO\",\"action\":\"MARKETING_CAMPAIGN_SENT\",\"actorEmail\":\"admin@unifiedtree.demo\",\"summary\":\"Campaign Diwali sent to 120 contacts\"}" "$ST"
expect "Marketing event lands in the workspace's audit trail" 200 "j['recorded']"
req GET "/v1/platform/admin/audit?tenantId=$TENANT_DEMO&module=marketing" "" "$OPS"
expect "... and the operator can read it there (workspace RLS)" 200 \
  "any(e['action']=='MARKETING_CAMPAIGN_SENT' for e in j['content'])"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
