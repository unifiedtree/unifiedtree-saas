# HR Letters — Merge Field Reference

All letter templates support merge fields written as `{{key}}`. The renderer substitutes
each key from the generation context; unrecognized keys render as a red
`[unresolved: key]` span so drafts show gaps visually.

## Syntax rules

| Pattern | Example | Notes |
|---------|---------|-------|
| `{{key}}` | `{{employee.firstName}}` | Standard lookup |
| `{{key:format}}` | `{{today:long}}` | Colon-separated format modifier |
| `{{keyCamelCase}}` | `{{employee.ctcWords}}` | CamelCase alias (supported for common fields, see table) |

**Only keys listed in this document are guaranteed to resolve.** Anything else is
unresolved. If you add a new field category, add it here and to
`MergeFieldResolver.buildContext()` in `hrms-letters`.

---

## Employee fields

| Key | Alias | Description | Example |
|-----|-------|-------------|---------|
| `employee.firstName` | | First name | Ravi |
| `employee.lastName` | | Last name | Kumar |
| `employee.fullName` | | First + last | Ravi Kumar |
| `employee.code` | | Employee code | EMP001 |
| `employee.workEmail` | | Work email | ravi@acme.com |
| `employee.personalEmail` | | Personal email | ravi@gmail.com |
| `employee.mobile` | | Phone number | +91 9999999999 |
| `employee.designation` | | Job title (from `employees.job_title`) | Software Engineer |
| `employee.department` | | Department name | Engineering |
| `employee.branch` | | Branch name | Mumbai HQ |
| `employee.joiningDate` | | Joining date, short format | 01 Jan 2026 |
| `employee.joiningDate:long` | | Joining date, long format | 1 January 2026 |
| `employee.confirmationDate` | | Confirmation date, short | 01 Jul 2026 |
| `employee.lastWorkingDay` | | Termination date, short | 31 Dec 2026 |
| `employee.ctc` | | Annual CTC, Indian format | ₹ 12,00,000 |
| `employee.ctc:words` | `employee.ctcWords` | Annual CTC in words | Twelve Lakh Rupees Only |
| `employee.manager` | | Reporting manager full name | Amit Sharma |

### How employee.ctc is calculated

`monthly_salary × 12`. If `monthly_salary` is null the ctc fields are unresolved.
There is no separate `ctc` column — the number comes from `hrms.employees.monthly_salary`.

### How employee.designation is resolved

`Employee` has no `designation_id` FK. The value comes from `hrms.employees.job_title`.
If `job_title` is null, `employee.designation` is unresolved. This is by design —
job title is free-form; designation is a display label.

---

## Company fields

Resolved from `org.companies` via `employee.company_id`.

| Key | Description | Example |
|-----|-------------|---------|
| `company.name` | Company display name | Acme Pvt Ltd |
| `company.legalName` | Legal / registered name | Acme Private Limited |
| `company.cin` | CIN / registration number | U12345MH2010PTC12345 |
| `company.pan` | Company PAN | AABCA1234C |
| `company.gstin` | GSTIN | 27AABCA1234C1Z5 |
| `company.signatoryName` | Signatory name | _(not yet stored — always unresolved)_ |
| `company.signatoryDesignation` | Signatory designation | _(not yet stored — always unresolved)_ |

---

## Date fields

Always resolved; no employee data required.

| Key | Format | Example |
|-----|--------|---------|
| `today` | dd MMM yyyy | 01 Jan 2026 |
| `today:long` | d MMMM yyyy | 1 January 2026 |
| `today:iso` | yyyy-MM-dd | 2026-01-01 |

---

## Overrides

The generate-letter API accepts an `overrides` map. Any key in that map wins over
the computed value, including computed employee/company fields. Use this for
one-off adjustments (e.g., a custom CTC figure for an offer that differs from the
current salary on record).

```json
{
  "templateId": "...",
  "employeeId": "...",
  "overrides": {
    "employee.ctc": "₹ 15,00,000",
    "employee.ctc:words": "Fifteen Lakh Rupees Only",
    "employee.ctcWords": "Fifteen Lakh Rupees Only"
  }
}
```

---

## Known aliases

These camelCase variants are registered in `MergeFieldResolver` alongside the
canonical colon-format key. Both work in templates. Add new aliases here as they're
accepted — the goal is one table, not tribal knowledge.

| Canonical key | Alias |
|---------------|-------|
| `employee.ctc:words` | `employee.ctcWords` |

---

## Adding a new merge field

1. Add the field to `MergeFieldResolver.buildContext()` in
   `modules/hrms-letters/.../service/MergeFieldResolver.java`
2. Add an entry to `MergeFieldResolver.catalogue()` so the editor picker shows it
3. Add a row to this document
4. If the field requires a new repository or entity join, inject it in both
   `LetterTemplateService` (preview) and `LetterGenerationService` (generate) — both
   code paths must stay in sync or preview will show different output than the PDF
