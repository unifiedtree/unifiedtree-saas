package com.hrms.api.employee;

import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.EmployeeDependent;
import org.springframework.http.HttpStatus;

import java.util.List;

/**
 * Redesign BW-101: a person's nominee shares may add up to 100 % at most.
 * Adding a dependent whose share would take the total above 100 is refused
 * with {@code NOMINEE_SHARE_OVER_100}; the message carries the running total
 * and what is still free. Existing rows are never touched or re-checked, so a
 * record that is already over 100 keeps working (only a new nominee share is
 * refused), and a dependent who isn't a nominee, or has no share, always saves.
 */
final class NomineeShares {

    static final String CODE = "NOMINEE_SHARE_OVER_100";

    private NomineeShares() {}

    /** The total of the nominee shares already on record. */
    static int total(List<EmployeeDependent> existing) {
        int sum = 0;
        if (existing == null) return 0;
        for (EmployeeDependent d : existing) {
            if (d != null && d.isNominee() && d.getNomineePercentage() != null) sum += d.getNomineePercentage();
        }
        return sum;
    }

    /** Throws when {@code adding} would take the nominee total above 100 %. */
    static void check(List<EmployeeDependent> existing, EmployeeDependent adding) {
        if (adding == null || !adding.isNominee() || adding.getNomineePercentage() == null) return;
        int share = adding.getNomineePercentage();
        if (share <= 0) return;
        int now = total(existing);
        if (now + share <= 100) return;
        int free = Math.max(0, 100 - now);
        String msg = free == 0
                ? "Nominee shares already add up to " + now + "%, so this person can't be a nominee with a share. Lower another nominee's share first."
                : "Nominee shares can add up to 100% at most. Nominees already hold " + now + "%, so this one can have up to " + free + "%.";
        throw new HrmsException(msg, HttpStatus.UNPROCESSABLE_ENTITY, CODE);
    }
}
