# Module ownership boundary

Backend modules `backend/modules/hrms-attendance` and `backend/modules/attendance-face`
are owned by a **separate contributor** (referenced in conversation as "friend").

## Scope

- **Backend modifications to those two modules** → DO NOT TOUCH without coordination.
- **Schema changes affecting attendance / face / geofence tables** → coordinate first.
- **Web frontend pages under `apps/platform/src/modules/hrms/attendance/`** → user-owned;
  may consume the attendance/geofence backend endpoints **additively**.
- **Adding new web frontend that consumes existing attendance endpoints** → user scope,
  no coordination needed. (e.g. a "Live Map" web page that polls the already-built
  `GET /v1/attendance/geofence/live-locations` — note that endpoint lives in
  `com.hrms.api.attendance.LegacyAttendanceExtrasController` in **hrms-app**, not in the
  friend's modules, so consuming it crosses no boundary.)
- **Changing punch-verification behavior** (e.g. the mobile-vs-web `GPS + Face` model
  mismatch — mobile requires both, web models a single `punch_method` of FACE/GPS/MANUAL)
  → requires coordination; it touches attendance logic, not just UI. Tracked as discovery
  question **A10b** in `docs/pilot-discovery-questions.md`.

## Status

This boundary was established **conversationally** and is **not formally contracted**.
If the contributor's identity becomes relevant for documentation purposes, update this
file with their name. Written down 2026-06-17 so the boundary survives session/handoff
drift (it previously lived only in conversation — no CODEOWNERS, README, or memory note).
