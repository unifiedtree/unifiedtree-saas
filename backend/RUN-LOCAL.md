# Running UnifiedTree HRMS locally — both browser and phone

You need three things running at the same time:

| # | What                                | Where                  | Port |
|---|--------------------------------------|------------------------|------|
| 1 | PostgreSQL                           | this machine           | 5432 |
| 2 | Spring HRMS backend (the JAR)        | this machine           | 8080 |
| 3 | Cloudflare quick-tunnel (optional)   | this machine → public  | 443  |
| 4 | Expo dev server                      | this machine           | 8081 |

The tunnel exists so the **Expo Go app on your phone** can reach the backend
without needing the phone on the same Wi-Fi as your dev machine. The **browser
on this same machine** can talk to the backend directly (`http://localhost:8080`)
*or* through the tunnel — either works once `.env` is pointed at the right URL.

---

## One-time setup

1. Install PostgreSQL 16 with database `hrms`, user `hrms`, password `hrms`
   (or set `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` env vars).
2. Make sure `cloudflared.exe` is at `C:\Users\LENOVO\.cloudflared\cloudflared.exe`
   — download it from
   <https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe>
   if missing. (Already installed if you've used the tunnel before.)
3. Run `mvn install -DskipTests -Dflyway.skip=true` once to build the JAR.

---

## Daily run order

Open three terminals.

### Terminal 1 — Spring backend

```powershell
cd C:\com\Unified\SaasWeb\backend
.\run_spring.ps1
```

Wait for `Started HrmsApplication ...` then `http://localhost:8080/api/actuator/health`
returns `200 UP`.

### Terminal 2 — Public tunnel (only needed if you'll test on the phone)

```powershell
cd C:\com\Unified\SaasWeb\backend
.\start-tunnel.ps1
```

It will:

- start `cloudflared` and capture the public URL (e.g. `https://abc-def-ghi.trycloudflare.com`)
- write `EXPO_PUBLIC_API_BASE_URL=<that URL>` into `Attendance_App\.env`
- print a sanity HEALTH 200 check
- stream cloudflared logs (Ctrl-C to stop the tunnel)

> Skip this terminal if you only want to test in the browser — set
> `EXPO_PUBLIC_API_BASE_URL=http://localhost:8080` in `Attendance_App\.env`
> by hand instead.

### Terminal 3 — Expo dev server

```powershell
cd C:\com\Unified\Attendance_App
npx expo start --tunnel --clear
```

`--clear` is important — it makes Expo re-read `.env`. Watch the console log:

```
[Config] API_BASE_URL = https://abc-def-ghi.trycloudflare.com/api
```

That should match the cloudflared URL. Now:

- **Browser**: open `http://localhost:8081`, the Expo Web build
- **Phone**: scan the QR code with Expo Go

Both will reach the backend through the same `EXPO_PUBLIC_API_BASE_URL`.

---

## CORS

The Spring `SecurityConfig` reads `hrms.security.cors.allowed-origins`. Default
is `*` (allow any origin pattern) so you don't need to touch backend config when
the cloudflared URL changes between sessions.

For production, lock it down:

```yaml
hrms:
  security:
    cors:
      allowed-origins: https://<tenant>.unifiedtree.com,https://api.unifiedtree.com
```

or via env var:

```
HRMS_CORS_ALLOWED_ORIGINS=https://<tenant>.unifiedtree.com
```

---

## When the tunnel URL changes

Cloudflare quick-tunnels generate a new random subdomain every time
`cloudflared` restarts. The helper script handles this:

1. Stop the old tunnel (Ctrl-C in Terminal 2)
2. Re-run `.\start-tunnel.ps1` — `.env` is rewritten automatically
3. Restart Expo with `--clear` so it picks up the new URL

---

## Demo accounts (already seeded in DB)

| Persona       | Login                         | Method             |
|---------------|-------------------------------|--------------------|
| Employee      | `9000000001` (mobile)          | OTP                |
| Manager       | `9000000002`                   | OTP                |
| Admin         | `9000000003` or `admin.role@demo-corp.com` | OTP / Password     |
| Administrator | `9000000004` or `administrator@demo-corp.com` | OTP / Password     |

In **dev mode with `OTP_DEBUG_RESPONSE_ENABLED=true`** (the default in
`run_spring.ps1`), the backend returns the OTP in the response body, and the
app's verify-OTP screen renders it in a yellow "Dev OTP" banner so you can
type it in without an SMS gateway.

---

## Troubleshooting

| Symptom                                                  | Fix                                             |
|----------------------------------------------------------|-------------------------------------------------|
| `ERR_NAME_NOT_RESOLVED` for `*.trycloudflare.com`        | Tunnel died. Re-run `.\start-tunnel.ps1`.       |
| `ERR_CONNECTION_REFUSED` for `localhost:8080`            | Backend not up. Re-run `.\run_spring.ps1`.      |
| `Failed to determine a suitable driver class`            | Postgres not running, or DB creds wrong.        |
| 503 on tunnel even though local works                    | Backend died after tunnel started — restart it. |
| Phone shows `localhost` in `[Config]` log                | Expo started before `.env` was written; restart with `--clear`. |
| CORS error on browser                                    | Should not happen with `allowed-origins=*`. If it does, restart backend so it picks up the YAML change. |
