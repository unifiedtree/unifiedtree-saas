# Face station (common face-punch kiosk) — v1 design

Spec §14.4, audit D-06 / D-07. Owner decision (6 Oct): "a Station mode for one branch: employee faces the
camera, gets matched, punch recorded with name + photo shown; unclear matches go to the manager to approve.
No new hardware."

## What it is
A shared device (an Android tablet running the app, or a browser on a computer with a camera) placed at a
branch. It is signed in as a **station**, not as a person. Anyone working at that branch walks up and punches
in or out with their face, without their own phone.

## Flow at the station
1. Tap **Punch in** or **Punch out**.
2. Find yourself: type at least 2 letters of your name or your employee code. Only people of this station's
   branch are listed (name, code, department; no photos, no attendance data).
3. Look at the camera. The photo is checked 1:1 against **that person's** enrolled face.
4. Success screen for a few seconds: the photo just taken, name, code, department, punch time, and either
   "Recorded" or "Recorded — your manager will confirm it" when the match was not certain. Then back to step 1.

Why pick-then-verify (not walk-up 1:N search): the face worker only does 1:1 verification today
(`FaceService.verify` against one person's templates). Picking first and then verifying 1:1 uses the
existing, tested matcher, thresholds, liveness and lockout unchanged. 1:N is a later step (face worker work).

## Rules reused (nothing new invented)
- Face: `FaceService.verify` (threshold, liveness, lockout, audit row in `face_verification_events`).
- Punch: `AssistedPunchRecorder.checkIn/checkOut` → `AttendanceService` (one punch in and one out a day,
  overnight shift close), so a station punch is an ordinary punch everywhere (Daily logs, payroll, alerts).
- Work area: the assisted punch's zone rule (the employee's branch or assigned zone, the server switch +
  company "Require geofencing on mobile", WFH day, "Anywhere"). The station sends its own location.
- "Punched by": each station punch is also written to `attendance.assisted_punches` with the station's name,
  so Daily logs, the Face punch review list and punch-in alerts say "by <station> (station)".
- Uncertain matches: a passed match in the MEDIUM band is already "To check" in the face review queue
  (web Attendance → Face punch, app HR → Face punches), team-scoped for the manager, company-wide for HR.
  "Yes, it's them" confirms; "Not them" rejects and the punch stops counting (existing rule).

## Approval (D-07)
- A station punch whose match is MEDIUM is saved with `needs_approval = true` in `attendance.station_punches`
  and the station tells the employee their manager will confirm it.
- It goes to the employee's manager (department head / direct manager with Attendance review) and HR through
  the existing face review queue. Approve → counts. Reject → does not count (the existing face-reject rule
  removes it from the day and from payroll).
- While waiting, it counts provisionally, exactly like every other uncertain face punch today. Making a
  waiting punch not count would change the day-status calculator that payroll reads; left for the owner.
- HIGH matches are recorded straight away, like a self face punch.

## Security model
- **Station login.** An admin/HR (needs `attendance.policy.manage` AND `attendance.assisted_punch.any`;
  OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER) creates a station for one branch on the website, then signs in on
  the device and taps "Start station on this device". The server issues a **station token** (a JWT with
  `token_type=station`, `station_id`, `tenant_id`, role `FACE_STATION`, permission `attendance.station.punch`,
  no employee id, no email; 30 days, renewed daily by the device). The admin's own session on that device is
  signed out at once.
- **Can only punch.** `StationScopeFilter` refuses a station token on every path except
  `/v1/attendance/station/**` (403). Those endpoints answer only: the station's own name/branch, a name/code
  search of its branch (name, code, department, face-ready), and the punch. `attendance.station.punch` is not in
  the permission catalog, so no human role can hold it, and the station endpoints also check the token type.
- **One branch.** The station row fixes company + branch; the search and the punch refuse anyone whose work
  branch (as the punch rules resolve it) is not that branch, or who is not an active employee.
- **Revocable.** Every station request re-reads the station row; a revoked station's token stops working on
  the next request (no waiting for expiry). Revoke is on the website setup page.
- **Traceable.** Every station punch records the station id (`attendance.station_punches`), the face event,
  the score band, and appears as "punched by <station>" + device "Station · <name>" in the face log.

## Data (V143_95, JDBC only, RLS like V143.40)
- `attendance.face_stations`: id, tenant, company, branch, name, status ACTIVE/REVOKED, created/revoked by+at,
  last_used_at.
- `attendance.station_punches`: id, tenant, station, attendance record, employee, date, type, punched_at,
  face_event_id, score_bucket, needs_approval.
No new permission, no JPA entity change. Without the migration the setup page shows "not switched on yet".

## API
Admin (human JWT):
- `GET  /v1/attendance/stations` — stations of the caller's company
- `POST /v1/attendance/stations` `{ name, branchId }`
- `POST /v1/attendance/stations/{id}/revoke`
- `POST /v1/attendance/stations/{id}/device-session` — token for this device (ACTIVE stations only)
Station (station token):
- `GET  /v1/attendance/station/me`
- `GET  /v1/attendance/station/people?q=` (≥ 2 characters, at most 8)
- `POST /v1/attendance/station/punch` `{ employeeId, type, imageBase64, challengePerformed, latitude, longitude, accuracy, deviceId }`
- `POST /v1/attendance/station/renew`

## Where it runs
- App: `app/station.tsx` (station mode; the root layout keeps a station-mode device on it) and
  `app/station-setup.tsx` (admin starts station mode on this tablet). Exit needs a long press + confirm and
  only forgets the token on the device.
- Web: `/station` (full-screen page, own token in localStorage, never the admin session) and the setup page
  `Attendance → Face stations` (create / revoke / open on this computer).

## Not in v1
Walk-up 1:N identification; offline queue at the station (online only, like assisted punch); a separate
"station punch needs approval" notification (the manager already gets the punch-in alert, which names the
station); per-company "every station punch needs approval"; a station PIN for exit.
