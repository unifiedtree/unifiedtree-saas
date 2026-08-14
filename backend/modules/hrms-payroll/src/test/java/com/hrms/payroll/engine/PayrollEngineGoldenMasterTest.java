package com.hrms.payroll.engine;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

/**
 * B10 — Payroll engine golden-master snapshot test.
 *
 * <p><b>DELIBERATELY DISABLED.</b> Per operator note 5 in the B10 bundle
 * brief: enabling this test canonicalises whatever the engine produces
 * today into the accepted expected output. If there is a subtle payroll
 * bug in the current engine (rounding, statutory ceiling, LOP, arrears),
 * a snapshot captured before Finance sign-off would turn that bug into
 * the "correct" behaviour — every future regression fix would then read
 * as a snapshot break, and the natural reaction is to re-baseline
 * rather than to fix the bug.
 *
 * <p><b>To enable this test:</b>
 * <ol>
 *   <li>Finance / payroll SME sign off on the exact expected numbers
 *       for the 10-employee fixture in
 *       {@code src/test/resources/fixtures/payroll_engine_golden.json}
 *       (all earnings, deductions, statutory buckets, net pay per
 *       employee) — spreadsheet check, not "whatever the engine says".</li>
 *   <li>Populate the "expected" section of that JSON with the
 *       signed-off numbers.</li>
 *   <li>Remove the {@link Disabled @Disabled} annotation below.</li>
 * </ol>
 *
 * <p>Do not enable this test before both steps 1 and 2 are done.
 *
 * <p>The 10-employee fixture must cover, at minimum:
 * <ul>
 *   <li>a full-attendance salaried employee (no LOP)</li>
 *   <li>a mid-month joiner (prorated basic)</li>
 *   <li>a mid-month leaver (prorated + F&amp;F)</li>
 *   <li>an LOP case (2 days unpaid mid-month)</li>
 *   <li>a PF-ceiling case (basic &gt; ₹15k, capped)</li>
 *   <li>an ESI-ceiling case (gross &gt; ₹21k, no ESI)</li>
 *   <li>a Professional Tax slab boundary case</li>
 *   <li>a variable pay / bonus case</li>
 *   <li>an advance-recovery case (see hrms-advance)</li>
 *   <li>a reimbursement batch case (see hrms-payroll batch service)</li>
 * </ul>
 *
 * @see com.hrms.payroll.engine.PayrollEngine
 * @see com.hrms.payroll.engine.PayrollEngineTest for per-scenario unit tests
 *      that predate this snapshot approach and remain the primary safety
 *      net until the golden master is signed off.
 */
class PayrollEngineGoldenMasterTest {

    @Test
    @Disabled(
        "TODO(B10, operator-note-5): golden-master requires Finance sign-off "
        + "on the 10-employee expected output before enabling — otherwise the "
        + "snapshot canonicalises whatever the engine emits today, bugs and all. "
        + "See payroll_engine_golden.json placeholder in src/test/resources/fixtures/.")
    void tenEmployeeSnapshotMatchesSignedOffFinanceReview() {
        // 1. Load fixtures/payroll_engine_golden.json → List<Employee input>
        //    and expected List<PayrollResult> (JSON-normalised BigDecimals).
        // 2. Run PayrollEngine.calculate() on each input.
        // 3. Serialise the actual results as JSON and diff against the
        //    expected block using AssertJ recursiveComparison ignoring
        //    generated ids/timestamps. On failure, print BOTH JSON blobs.
        // 4. On intentional engine change: update the fixture file in the
        //    same commit as the engine change, cite the change reason in
        //    the commit message, and get a Finance re-approval.
        throw new UnsupportedOperationException(
            "See @Disabled reason — sign-off pending.");
    }
}
