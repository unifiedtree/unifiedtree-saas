package com.hrms.api.employee;

/**
 * Redesign BW-99: the identity numbers a person sees on their OWN profile when
 * they don't hold hrms.employee.identity.read. Every number keeps only its last
 * four characters ("••••••234F"); the passport expiry date is shown as it is.
 * Aadhaar is already stored and returned as its last four digits only.
 */
final class IdentityMask {

    private IdentityMask() {}

    static String lastFour(String value) {
        if (value == null) return null;
        String v = value.replaceAll("\\s", "");
        if (v.isEmpty()) return v;
        if (v.length() <= 4) return "•".repeat(v.length());
        return "•".repeat(v.length() - 4) + v.substring(v.length() - 4);
    }

    static EmployeeProfileController.IdentityResponse mask(EmployeeProfileController.IdentityResponse r) {
        if (r == null) return null;
        return new EmployeeProfileController.IdentityResponse(
                r.id(), r.employeeId(),
                lastFour(r.pan()),
                r.aadhaarLast4(),
                lastFour(r.uan()),
                lastFour(r.esicNumber()),
                lastFour(r.passportNumber()),
                r.passportExpiry());
    }
}
