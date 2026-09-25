package com.hrms.api.hiring;

import com.hrms.employee.entity.OnboardingTemplate;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Which checklist template a converted candidate's onboarding starts with. */
class ConversionOnboardingStarterTest {

    private static final UUID SALES = UUID.randomUUID(), TECH = UUID.randomUUID(), ENGINEER = UUID.randomUUID();

    private static OnboardingTemplate t(String name, UUID dept, UUID desig, boolean active) {
        OnboardingTemplate t = new OnboardingTemplate();
        t.setId(UUID.randomUUID());
        t.setName(name);
        t.setDepartmentId(dept);
        t.setDesignationId(desig);
        t.setActive(active);
        return t;
    }

    @Test
    void prefersTheMostSpecificActiveTemplate() {
        var general = t("General joining", null, null, true);
        var tech = t("Tech joining", TECH, null, true);
        var techEngineer = t("Tech engineer joining", TECH, ENGINEER, true);
        var engineer = t("Engineer joining", null, ENGINEER, true);
        var all = List.of(engineer, general, techEngineer, tech);
        assertSame(techEngineer, ConversionOnboardingStarter.pick(all, TECH, ENGINEER));
        assertSame(tech, ConversionOnboardingStarter.pick(List.of(general, tech, engineer), TECH, ENGINEER));
        assertSame(engineer, ConversionOnboardingStarter.pick(List.of(general, engineer), SALES, ENGINEER));
        assertSame(general, ConversionOnboardingStarter.pick(all, SALES, null));
    }

    @Test
    void anotherDepartmentsTemplateIsNeverUsed() {
        assertNull(ConversionOnboardingStarter.pick(List.of(t("Tech joining", TECH, null, true)), SALES, null));
        assertNull(ConversionOnboardingStarter.pick(List.of(t("Tech joining", TECH, null, true)), null, null));
    }

    @Test
    void archivedTemplatesAndEmptyListsGiveNothing() {
        assertNull(ConversionOnboardingStarter.pick(List.of(t("Old", null, null, false)), null, null));
        assertNull(ConversionOnboardingStarter.pick(List.of(), TECH, null));
        assertNull(ConversionOnboardingStarter.pick(null, TECH, null));
    }
}
