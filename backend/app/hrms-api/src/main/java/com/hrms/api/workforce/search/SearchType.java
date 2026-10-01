package com.hrms.api.workforce.search;

import java.util.List;

/**
 * What the top bar's search looks through, in the order the groups are shown.
 *
 * <p>{@code module} is the workspace module the type's own endpoints sit behind
 * in {@code TenantModuleGuard} (/v1/leave → leave, /v1/payroll → payroll,
 * everything else here → hrms), so search never shows what the workspace can't
 * open. {@code keywords} are words that name the type itself: "leave" or
 * "payslips" lists the latest records of that type instead of looking for the
 * word inside them ("leave ravi" = Ravi's leave requests).
 */
public enum SearchType {
    EMPLOYEE("employee", "People", "hrms", List.of()),
    LEAVE("leave", "Leave requests", "leave", List.of("leave", "leaves")),
    EXPENSE("expense", "Expense claims", "hrms", List.of("expense", "expenses", "claim", "claims", "reimbursement", "reimbursements")),
    PAYSLIP("payslip", "Payslips", "payroll", List.of("payslip", "payslips", "salary", "slip", "slips")),
    DOCUMENT("document", "Documents", "hrms", List.of("document", "documents", "doc", "docs")),
    LETTER("letter", "Letters", "hrms", List.of("letter", "letters")),
    CANDIDATE("candidate", "Candidates", "hrms", List.of("candidate", "candidates", "applicant", "applicants")),
    OFFER("offer", "Job offers", "hrms", List.of("offer", "offers")),
    JOB("job", "Job openings", "hrms", List.of("job", "jobs", "opening", "openings", "requisition", "requisitions", "vacancy", "vacancies")),
    POLICY("policy", "Policies", "hrms", List.of("policy", "policies", "handbook")),
    // Redesign BW-04: the company's holidays this year and next (the Leave page's Holidays tab).
    HOLIDAY("holiday", "Holidays", "hrms", List.of("holiday", "holidays", "festival", "festivals")),
    // Requests (the client asked to search "everything"): each as its own list page shows it.
    WFH("wfh", "Work from home requests", "attendance", List.of("wfh", "remote", "request", "requests")),
    SHIFT_CHANGE("shift_change", "Shift change requests", "attendance", List.of("shift", "shifts", "swap", "request", "requests")),
    CORRECTION("correction", "Attendance fixes", "attendance",
            List.of("correction", "corrections", "regularization", "regularisation", "regularize", "regularise", "fix", "fixes", "request", "requests")),
    ADVANCE("advance", "Salary advances", "hrms", List.of("advance", "advances", "loan", "loans", "request", "requests")),
    OVERTIME_REQUEST("overtime_request", "Overtime requests", "attendance", List.of("overtime", "ot", "request", "requests"));

    public final String key;
    public final String label;
    public final String module;
    public final List<String> keywords;

    SearchType(String key, String label, String module, List<String> keywords) {
        this.key = key;
        this.label = label;
        this.module = module;
        this.keywords = keywords;
    }
}
