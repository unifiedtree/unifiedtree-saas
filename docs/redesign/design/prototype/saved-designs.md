# Saved dashboard designs

Kept on request so they can be brought back at any time. Both live in the real files as switches; nothing is deleted.

## 1. Header A — outlined pills
- Section tabs as separate outlined pills with icons; the active tab is a solid green pill.
- Search: pill with rotating "Search people / payslips / leave / reports" text, ⌘ K keys and a round green search button.
- Where: `HrmsPlatform.dc.html`, the `{{ dashPillsA }}` and `{{ searchA }}` branches.
- Turn on: Tweaks → Dashboard → Header = "A: outlined pills".

## 2. Quick actions A — animated tile row under the stat cards
- Six large tiles with the animated icons (Approve leave, Add employee, Run payroll, Regularise, Announce, Reports), "Most used first" + Customise, sitting directly below the 8 stat cards.
- The greeting row then shows the date chip, Export headcount and Add employee on the right.
- Where: `PgDashboard.dc.html`, the `{{ qTiles }}` branches; tiles are `UtQuick.dc.html`.
- Turn on: Tweaks → Dashboard → Quick actions = "A: tile row".

## Preview with both on
`SavedHeaderTiles.dc.html` opens the platform with Header A, wide stat cards and the tile row.

## Current defaults
Header C (dark green bar), Stat cards A (wide), Quick actions C (icon dock).
