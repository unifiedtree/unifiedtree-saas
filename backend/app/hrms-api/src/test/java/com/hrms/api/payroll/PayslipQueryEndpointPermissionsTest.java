package com.hrms.api.payroll;

import org.junit.jupiter.api.Test;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * V143.86: HR answers payslip questions with payroll.queries.answer, not with
 * payroll.runs.manage. The question queue (list + answer) opens for either code;
 * every other payroll endpoint ignores the new one, so it never reaches a run.
 */
class PayslipQueryEndpointPermissionsTest {

    private static final String ANSWER = "payroll.queries.answer";
    private static final String MANAGE = "payroll.runs.manage";

    /** Every controller in com.hrms.api.payroll. */
    private static final List<Class<?>> PAYROLL_CONTROLLERS = List.of(
            BankProfileController.class, DisbursementBatchController.class, EmployeeStructureController.class,
            MyPayController.class, PayrollDashboardController.class, PayrollReportController.class,
            PayrollRunController.class, PayrollRunInsightsController.class, PayrollSettingsController.class,
            PayslipQueryController.class, SalaryComponentController.class, SalaryStructureBulkController.class,
            SalaryStructureListController.class, StatutoryFileController.class);

    @Test
    void theQueueListAndAnswerTakeEitherCodeAtTheirPaths() {
        assertEquals("@perm.hasAny('payroll.runs.manage','payroll.queries.answer')", PayslipQueryController.ANSWER_GUARD);
        assertGuard("list", "/queries", PayslipQueryController.ANSWER_GUARD);
        assertGuard("answer", "/queries/{id}/answer", PayslipQueryController.ANSWER_GUARD);
        // The employee's own side is unchanged.
        assertGuard("mine", "/payslips/me/queries", "hasAuthority('payroll.payslip.read.self')");
        assertGuard("ask", "/payslips/me/{runId}/queries", "hasAuthority('payroll.payslip.read.self')");
    }

    @Test
    void theNewCodeAloneOpensOnlyTheQuestionQueue() {
        assertEquals(Set.of("PayslipQueryController.list", "PayslipQueryController.answer"), opened(Set.of(ANSWER)));
    }

    @Test
    void thePayrollTeamStillReachesTheQueueWithoutTheNewCode() {
        Set<String> open = opened(Set.of(MANAGE));
        assertTrue(open.contains("PayslipQueryController.list"), open.toString());
        assertTrue(open.contains("PayslipQueryController.answer"), open.toString());
    }

    @Test
    void anEmployeeWithNeitherCodeCannotReadOrAnswerTheQueue() {
        Set<String> open = opened(Set.of("payroll.payslip.read.self"));
        assertFalse(open.contains("PayslipQueryController.list"), open.toString());
        assertFalse(open.contains("PayslipQueryController.answer"), open.toString());
        assertTrue(open.contains("PayslipQueryController.ask"), open.toString());
    }

    @Test
    void hrGetsNothingNewInPayrollRunsFromTheNewCode() {
        // HR_MANAGER's payroll codes today, with and without the new one: the only difference is the queue.
        Set<String> hr = Set.of("payroll.runs.read", "payroll.settings.read", "payroll.components.read", "payroll.payslip.read.self");
        Set<String> withAnswer = new java.util.HashSet<>(hr);
        withAnswer.add(ANSWER);
        Set<String> gained = new TreeSet<>(opened(withAnswer));
        gained.removeAll(opened(hr));
        assertEquals(Set.of("PayslipQueryController.answer", "PayslipQueryController.list"), gained);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static void assertGuard(String method, String path, String guard) {
        Method m = method(PayslipQueryController.class, method);
        assertEquals(guard, m.getAnnotation(PreAuthorize.class).value(), method);
        assertEquals(path, path(m), method);
    }

    /** The guarded payroll endpoints a person holding exactly {@code held} gets through. */
    private static Set<String> opened(Set<String> held) {
        Set<String> open = new TreeSet<>();
        List<String> unguarded = new ArrayList<>();
        for (Class<?> c : PAYROLL_CONTROLLERS) {
            for (Method m : c.getDeclaredMethods()) {
                if (path(m) == null) continue;
                PreAuthorize guard = m.getAnnotation(PreAuthorize.class);
                if (guard == null) guard = c.getAnnotation(PreAuthorize.class);
                if (guard == null) {
                    unguarded.add(c.getSimpleName() + "." + m.getName());
                    continue;
                }
                if (allows(guard.value(), held)) open.add(c.getSimpleName() + "." + m.getName());
            }
        }
        assertEquals(List.of(), unguarded, "payroll endpoints without @PreAuthorize");
        return open;
    }

    private static boolean allows(String expression, Set<String> held) {
        StandardEvaluationContext ctx = new StandardEvaluationContext(new Root(held));
        ctx.setBeanResolver((context, name) -> {
            if ("perm".equals(name)) return new Perm(held);
            throw new IllegalArgumentException("unknown bean @" + name + " in " + expression);
        });
        Boolean ok = new SpelExpressionParser().parseExpression(expression).getValue(ctx, Boolean.class);
        return Boolean.TRUE.equals(ok);
    }

    /** The parts of Spring Security's expression root the payroll guards use. */
    public static final class Root {
        private final Set<String> held;
        Root(Set<String> held) { this.held = held; }
        public boolean hasAuthority(String code) { return held.contains(code); }
        public boolean hasAnyAuthority(String... codes) { return Arrays.stream(codes).anyMatch(held::contains); }
    }

    /** Stands in for PermissionChecker (@perm), which reads the same codes from the database. */
    public static final class Perm {
        private final Set<String> held;
        Perm(Set<String> held) { this.held = held; }
        public boolean check(String code) { return held.contains(code); }
        public boolean check(String code, Object resourceId) { return held.contains(code); }
        public boolean hasAny(String... codes) { return Arrays.stream(codes).anyMatch(held::contains); }
        public boolean hasAll(String... codes) { return Arrays.stream(codes).allMatch(held::contains); }
    }

    private static Method method(Class<?> c, String name) {
        return Arrays.stream(c.getDeclaredMethods()).filter(x -> x.getName().equals(name)).findFirst()
                .orElseThrow(() -> new AssertionError("missing " + c.getSimpleName() + "." + name));
    }

    private static String path(Method m) {
        String[] v = null;
        if (m.getAnnotation(GetMapping.class) != null) v = m.getAnnotation(GetMapping.class).value();
        else if (m.getAnnotation(PostMapping.class) != null) v = m.getAnnotation(PostMapping.class).value();
        else if (m.getAnnotation(PutMapping.class) != null) v = m.getAnnotation(PutMapping.class).value();
        else if (m.getAnnotation(PatchMapping.class) != null) v = m.getAnnotation(PatchMapping.class).value();
        else if (m.getAnnotation(DeleteMapping.class) != null) v = m.getAnnotation(DeleteMapping.class).value();
        if (v == null) return null;
        return v.length == 0 ? "" : v[0];
    }
}
