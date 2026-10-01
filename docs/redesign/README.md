# UnifiedTree HRMS redesign: start here

The HRMS module is being rebuilt on a new design (the handoff is in `design/`). The work is split into packages; each
package owns a set of files, and nobody edits another package's files.

## Read in this order
1. `TEAMMATE_SETUP.md`: run everything locally on Windows; the rules that never bend.
2. `DECISIONS.md`: every binding decision. Item 21 holds the client's latest answers and **wins over older items**.
3. `REDESIGN_RULES.md`: tokens, the shared kit, tests. The **SHELL CONTRACT UPDATE** at the end replaces the older contract.
4. `PACKAGE_BRIEF.md`: how to build a package and the report format.
5. `AUDIT.md` + `AUDIT-ADDENDUM.md`: the screen-by-screen map and the package plan (§6.3). The addendum wins where they differ.
6. `CONTRACTS.md`: shared hooks, endpoints, permissions and notification types.
7. Your task in `tasks/`, and the area audit(s) it names in `audit/`.

## Paths in these docs
- The docs were written on the lead's PC. A path like `/c/REACT/ut-wt/redesign/X` means **`docs/redesign/X` in this repo**.
- `/c/REACT/ut-wt/design-ref/design_handoff_hrms_redesign/` is **`docs/redesign/design/`**.
- The lead's tools (`heavy.sh`, `live-slot.sh`, `vite.sh`, `rel-gate.sh`, the stable backend on :8070) exist only on the
  lead's PC. On yours, follow `TEAMMATE_SETUP.md` (local backend on :8080, web app on :3002).
- Reference screenshots (`ref/`) aren't committed (79 MB). Regenerate the ones you need with `e2e/capture-handoff.mjs`.

## Where things stand (1 Oct 2026)
- **Live:** Release 1, with the new theme, kit, shell and dashboard.
- **Being built by the lead now:** Release 1.1 (Inter font, module pages as top tabs, tighter dashboard, full-name
  greeting, "Upcoming events"), Team, Attendance (incl. web face punch), self-service Home, Org chart.
- **Backends already built** and in `redesign/int`: Team/Undo, Attendance, Shifts/Overtime, Leave, Home, Payroll,
  Workforce, Hiring, PLI/Advances/F&F, Expenses. Their SCREENS are the next tasks.
- **ON HOLD:** shift planning (rotations, swaps); everything about workspaces/companies/settings placement (waits for a client decision).
