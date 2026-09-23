# Review the company-admin workspace

Open http://demo.localhost:3002/dashboard. Local demo login: **owner@unifiedtree.demo** / **Hrms@12345**. This is the company owner, not the SaaS super administrator. Records marked Local QA belong to the isolated test database.

After signing in, the app chooser opens. Select **HR & Employees** to enter the company dashboard and its HR, attendance, leave and payroll screens. Other catalog products marked Soon are separate future apps.

## Start with the client's three concerns

1. **Who is late?** On the dashboard, select **Late arrivals**. The attendance table keeps the selected date and shows the named employee. Open their profile for details.
2. **Change someone's shift.** Search for an employee in the header, open their profile and select **Change shift**. Save the assignment, reload and reopen the panel to see the persisted shift.
3. **Who raised the request?** Open **Time > Attendance > Corrections**. The admin approval queue shows employee identity, department, requested times, reason and attachment. A decision updates the request and attendance record. Shift-change requests have a separate approval queue.

## Other useful review paths

- **Add employee:** dashboard action opens the eight-step onboarding wizard. After saving, open the employee profile to review probation, bank account, salary and supplementary HR details.
- **Expenses:** review employee claims, then open reimbursement batches. Build a draft, inspect named claims, post, cancel or record an actual payment reference. Currency is explicit.
- **Payroll:** calculate a run, inspect payslips and lock it. Bank disbursement shows included/excluded employees and why. Correct missing bank details and rebuild before posting/payment. CSV download does not transfer money.
- **Advances:** review requests, inspect installments and ledger, defer a pending installment or record settlement/write-off. Paid/closed history remains visible.
- **Performance:** create measurable KPIs, record progress, inspect history, initiate a review cycle and inspect its reviewer roster and completion.
- **Letters:** choose a template and employee, generate a letter, inspect the named recipient and download PDF. Local verification did not send email.
- **Exit:** open the employee profile's exit section to record notice/separation details. Full and Final Settlement shows itemized earnings and deductions; an unapproved settlement can be cancelled for correction. Approval checks outstanding advances. A different authorized user records the payment.
- **Company settings > Users / Roles:** inspect role permissions and change user access. Built-in role definitions are read-only; clone a role to customize it.

Use the module tabs beneath the header for related screens. Employee search also opens permitted pages and actions. Empty lists and missing data are represented explicitly; dashboard figures come from APIs.

## Local provider limits

Private binary document storage requires the separate R2_DOCUMENT_BUCKET. Email, Firebase phone login and the face worker require their configured providers. Bank/payment actions record or export administrative payment instructions; this build does not initiate transfers.

See [the engineering evidence and deployment notes](UI_UX_RECOVERY_AUDIT.md) for test coverage, migrations and startup details. Do not treat this local demonstration as production deployment approval.
