# UnifiedTree HRMS: the full plan, phase by phase (written 1 Oct 2026)

**Deadline:** Wednesday 7 Oct. Claude usage resets Sunday night (4 Oct).
**Live today:** Release 1 (`11d3fbf8`): new look, side bar, header, More panel, redesigned dashboard. Frontend only.
**Built but not released** (in `rd/int`): the backends for Team/Undo, Attendance, Shifts/Overtime, Leave, Home, Payroll, Workforce, Hiring, PLI/Advances/F&F and Expenses, with migrations V143_50–65.

## How we work
- **Lead (Opus): me.** I plan each package, review, merge, run the full test gate and push.
- **Builders:** 3–4 at once. Opus for backend, migrations and anything security-related; Sonnet for screens, restyles and test updates. No "ultra" workflows.
- **Every release:** type check, unit tests, build, the 55-script regression against the baseline, plus each package's own live test and light/dark/phone screenshots. Then push to `main`, with a list of DB migrations to apply by hand in production.
- **Rule:** no backend API ships without the screen that uses it.

## Phases

| Phase | When | What | Size |
|---|---|---|---|
| **0. Answers & references** | Thu–Fri | You answer the questions below; collect Keka, My Bill Book and NextWave references; client meeting on Friday | — |
| **1. Release 1.1: fix what's live** | Fri | old font; module sub-pages as top tabs (no left Pages panel); page sub-sections inside the page; dashboard 10% more compact; full-name greeting | ½ day |
| **2. Release 2: daily-use screens** (backends ready) | Sat–Sun | Team (Keka-style manager view, Approvals + Undo, reminders, probation, message team); Attendance (daily tracking, web punch-in with face scan per NextWave, face punches by calendar, breaks, timesheet); Leave (approvals incl. bulk and HR level, all balances, apply on behalf, calendar, holiday edit); Shifts & overtime (OT threshold 30 min / 1 h, OT types, calendar selection, temporary shift change); self-service Home (my day, needs you, my requests, Upcoming events) | 2 days |
| **3. Release 3: people, access, calendar, search** | Sun–Mon | Roles & access page + Access tab on every employee + add a role inline; employee details/profile; Add employee + import + onboarding (with Friday's input); hiring and assets; Keka org tree; calendar with 6 presets (My Bill Book) everywhere + Keka dashboard calendar; global search + notifications popover | 2 days |
| **4. Release 4: pay and money** | Mon–Tue | Payroll (dashboard, runs, structures, settings, bank); Expenses; PLI, advances and F&F; My payslips and salary; dashboard extras (Customise quick actions) | 1½ days |
| **5. Release 5: remaining HRMS areas** | Tue–Wed | Keka-style rules & policies + master overview + org setup; letters and documents + logo/letterhead/template previews; performance, learning, exit; reports and analytics; compliance, HR configuration, notification templates, integrations; app-to-web parity gaps | 2 days |
| **6. Workspace, settings, website** (PAUSED for the client decision) | after the decision | one workspace per sign-up, companies inside HRMS; workspace settings on the modules page and one settings per module; users, roles, audit pages; companies and branches screens; website: Keka-style login, HRMS pricing on its own, sign-up wording | 1–1½ days |
| **7. Final QA & go-live** | Wed | full regression + every live test; all pages light/dark/phone; production migration checklist in order; push; production smoke test | ½ day |
| **8. Shift planning** | after Wed | rotations (2+2+2+1), date-range planning wizard, bulk import and assign, swaps (both accept + approver), rotational shifts | 4–5 days |
| **9. Mobile app** (separate repo) | after Wed | notification badge bug, page-not-found screen, full name, Upcoming events, add role inline, Alerts tab (notifications + messaging), face reset with push + re-enrollment, NextWave enrollment, dark/light theme, maps alternative, admin payment, sync with web | 1–1½ weeks |
| **10. Kept for later** (each needs a client rule) | after Wed | optional/branch holidays, comp-off, unpaid leave beyond balance, payslip on hold, TDS, OT pay, alternate Saturdays, probation auto-extend, more notification events, profile self-edit, Undo for more types, integrations/invoices/OCR, course learning, report pins/builder, kudos | as decided |
| **11. New products** (separate projects) | later | Wallet; Marketing automation (multi-platform posting, Meta pixel, Meta policies, ChatGPT ads); Hospitals (on hold) | 3–6 weeks each |

**Honest view of Wednesday:** Phases 1–4 are solid. Phases 5 and 6 are likely if answers arrive by Friday and usage doesn't stall. If something slips, it's Phase 5's less-used areas first (reports, performance).

## Questions (answer by number). Status: OPEN as of 1 Oct
**Before Phase 1:**
1. Old font = Inter?
2. Keep the new rail and move module pages to top tabs (no left Pages panel), or revert the rail?
3. Page sub-sections inside the page, under the top tabs?
4. Dashboard 10% smaller: spacing and sizes only?
5. Greeting: full name on web and app?
6. Keep dark mode?

**Before Phase 2:**
7. Web face punch-in: for whom, geofence, liveness?
8. Does the NextWave video cover enrollment and punch-in?
9. What's missing in the manager face punch?
10. Overtime threshold, timing types and calendar selection: examples needed.
11. Face punches calendar-wise: which view?
12. Upcoming events contents.
13. Keka manager-view screenshots.
14. Who applies production DB changes, and when?

**Before Phase 3:**
15. Roles & access page design and who may change access.
16. Inline role: start as a copy of an existing role?
17. Org tree basis and visibility.
18. The 6 calendar presets + My Bill Book screenshots.
19. Keka dashboard-calendar screenshots.
20. Global search scope.
21. Add employee/onboarding changes (Friday).

**Before Phase 4:**
22. Any payroll/expense changes?

**Before Phase 5:**
23. Keka rules & policies screenshots.
24. Which upload previews.
25. App-to-web parity list, or should I compare?

**Phase 6 (Friday's client meeting):**
26. One workspace per sign-up + companies inside modules?
27. Production accounts with 2+ workspaces (SQL)?
28. Invited people in other workspaces?
29. "Business name" label?
30. Companies under HRMS → Organization setup?
31. Settings model?
32. Keka login screenshots: which login?
33. HRMS pricing model / buy one module alone?

**Scope of later phases:**
34. Shift planning by Wednesday or after?
35. Meaning of 2+2+2+1?
36. Swap approver; bulk-import columns?
37. Mobile app scope and owner?
38. Admin payment in app?
39. Maps alternative: why and which?
40. Messaging: WhatsApp project or new?
41. Badge bug details?
42. Meaning of app/web sync?
43. Wallet details?
44. Marketing platforms, Meta account, relation to WhatsApp?
45. Hospitals on hold?
46. Any kept-for-later items now?

**Process:**
47. Claude usage split with the teammate?
48. How the client tests between releases?
