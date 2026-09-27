package com.hrms.api.approvals;

/**
 * The five kinds of request whose approve / reject can be taken back
 * (redesign DECISIONS 15). The name is the journal's {@code kind} and the
 * {@code kind} field of the web contract ({@code DecisionKind} in
 * {@code api/shared/contracts.ts}).
 */
public enum DecisionKind {
    LEAVE("leave request", "/leave-history"),
    WFH("work-from-home request", "/wfh-apply"),
    CORRECTION("attendance correction", "/my-corrections"),
    SHIFT_CHANGE("shift change", "/shift-change"),
    EXPENSE("expense claim", "/my-claims");

    private final String requestType;
    private final String mobileRoute;

    DecisionKind(String requestType, String mobileRoute) {
        this.requestType = requestType;
        this.mobileRoute = mobileRoute;
    }

    /** "leave request", "work-from-home request", …: the words the employee's notification uses. */
    public String requestType() {
        return requestType;
    }

    /** Where the employee sees this kind of request in the mobile app (the same routes its decision notifications use). */
    public String mobileRoute() {
        return mobileRoute;
    }
}
