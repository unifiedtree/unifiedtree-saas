package com.hrms.api.performance;

import com.hrms.api.learning.LearningController;
import com.hrms.api.learning.SkillAssessmentController;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Every endpoint P-GROW adds or changes carries the permission the plan names
 * (AUDIT §3.3 BW-78…BW-85) and the path the web app calls.
 */
class GrowEndpointPermissionsTest {

    private record Expect(Class<?> controller, String method, String path, String guard) {}

    private static final List<Expect> ENDPOINTS = List.of(
            new Expect(PerformanceController.class, "listCycles", "/cycles", "hasAuthority('hrms.performance.read')"),
            new Expect(PerformanceController.class, "cycleSummary", "/cycles/summary", "hasAuthority('hrms.performance.read')"),
            new Expect(PerformanceController.class, "cycleStages", "/cycles/{id}/stages", "hasAuthority('hrms.performance.read')"),
            new Expect(PerformanceController.class, "cycleRatings", "/cycles/{id}/ratings", "hasAuthority('hrms.performance.read')"),
            new Expect(PerformanceController.class, "saveMilestones", "/cycles/{id}/milestones", "hasAuthority('hrms.performance.write')"),
            new Expect(PerformanceController.class, "shareCycle", "/cycles/{id}/share", "hasAuthority('hrms.performance.write')"),
            new Expect(PerformanceController.class, "myCurrentCycle", "/cycles/my-current", "hasAuthority('hrms.performance.review.self')"),
            new Expect(PerformanceController.class, "listReviews", "/reviews", "hasAuthority('hrms.performance.read')"),
            new Expect(PerformanceController.class, "myReviews", "/reviews/my", "hasAuthority('hrms.performance.review.self')"),
            new Expect(PerformanceController.class, "saveDraft", "/reviews/{id}/draft", "hasAuthority('hrms.performance.review.self')"),
            new Expect(PerformanceController.class, "myGoals", "/goals/my", "hasAuthority('hrms.performance.review.self')"),
            new Expect(PerformanceController.class, "createGoal", "/goals", "hasAuthority('hrms.performance.review.self')"),
            new Expect(AppraisalCycleController.class, "remind", "/reviews/{id}/remind", "hasAuthority('hrms.performance.write')"),
            new Expect(KpiController.class, "summary", "/summary", "hasAuthority('hrms.performance.read')"),
            new Expect(CompanyKpiController.class, "list", "", "hasAnyAuthority('hrms.performance.read','hrms.performance.review.self')"),
            new Expect(CompanyKpiController.class, "create", "", "hasAuthority('hrms.kpi.manage')"),
            new Expect(CompanyKpiController.class, "update", "/{id}", "hasAuthority('hrms.kpi.manage')"),
            new Expect(LearningController.class, "programsSummary", "/programs/summary", "hasAuthority('hrms.learning.read')"),
            new Expect(LearningController.class, "programCategories", "/programs/categories", "hasAuthority('hrms.learning.read')"),
            new Expect(LearningController.class, "certifications", "/certifications", "hasAuthority('hrms.learning.skill.read')"),
            new Expect(SkillAssessmentController.class, "propose", "", "hasAuthority('hrms.learning.skill.assess.self')"));

    @Test void everyEndpointHasItsPermissionAndPath() {
        for (Expect e : ENDPOINTS) {
            Method m = Arrays.stream(e.controller().getDeclaredMethods()).filter(x -> x.getName().equals(e.method()))
                    .findFirst().orElseThrow(() -> new AssertionError("missing " + e.controller().getSimpleName() + "." + e.method()));
            PreAuthorize guard = m.getAnnotation(PreAuthorize.class);
            assertNotNull(guard, e.method() + " has no @PreAuthorize");
            assertEquals(e.guard(), guard.value(), e.method());
            assertEquals(e.path(), path(m), e.method());
        }
    }

    private static String path(Method m) {
        GetMapping g = m.getAnnotation(GetMapping.class);
        if (g != null) return g.value().length == 0 ? "" : g.value()[0];
        PostMapping p = m.getAnnotation(PostMapping.class);
        if (p != null) return p.value().length == 0 ? "" : p.value()[0];
        PutMapping u = m.getAnnotation(PutMapping.class);
        if (u != null) return u.value().length == 0 ? "" : u.value()[0];
        return null;
    }
}
