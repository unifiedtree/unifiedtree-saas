package com.hrms.api.onboarding;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.OnboardingTask;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.repository.*;
import com.hrms.employee.service.OnboardingService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Reordering template tasks and choosing a task's owner from the workspace's roles. */
class OnboardingTemplateTaskTest {

    private final OnboardingTemplateRepository templates = mock(OnboardingTemplateRepository.class);
    private final OnboardingTaskRepository tasks = mock(OnboardingTaskRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final OnboardingService service = new OnboardingService(templates, tasks, mock(OnboardingInstanceRepository.class),
            mock(OnboardingInstanceTaskRepository.class), mock(OnboardingAssetRepository.class), jdbc);
    private OnboardingTemplate template;
    private OnboardingTask a, b, c;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(UUID.randomUUID());
        template = new OnboardingTemplate();
        template.setId(UUID.randomUUID());
        template.setTenantId(TenantContext.getTenantId());
        a = task("Sign handbook", 1);
        b = task("Laptop setup", 2);
        c = task("Meet the team", 3);
        template.setTasks(new ArrayList<>(List.of(a, b, c)));
        when(templates.findById(template.getId())).thenReturn(Optional.of(template));
        when(tasks.save(any(OnboardingTask.class))).thenAnswer(i -> i.getArgument(0));
    }

    @AfterEach
    void clear() { TenantContext.clear(); }

    private OnboardingTask task(String title, int seq) {
        OnboardingTask t = new OnboardingTask();
        t.setId(UUID.randomUUID());
        t.setTitle(title);
        t.setSequenceNo(seq);
        t.setTemplateId(template.getId());
        return t;
    }

    @Test
    void reorderRenumbersEveryTaskInTheGivenOrder() {
        OnboardingTemplate result = service.reorderTasks(template.getId(), List.of(c.getId(), a.getId(), b.getId()));
        assertEquals(1, c.getSequenceNo());
        assertEquals(2, a.getSequenceNo());
        assertEquals(3, b.getSequenceNo());
        assertEquals(List.of(c, a, b), result.getTasks());
        verify(tasks).saveAll(anyList());
    }

    @Test
    void reorderMustListEveryTaskExactlyOnce() {
        for (List<UUID> bad : List.of(
                List.of(a.getId(), b.getId()),                          // one missing
                List.of(a.getId(), b.getId(), b.getId()),               // repeated
                List.of(a.getId(), b.getId(), UUID.randomUUID()))) {    // a task of another template
            BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> service.reorderTasks(template.getId(), bad));
            assertEquals("TASK_ORDER_INVALID", e.getErrorCode());
        }
        assertThrows(BusinessRuleException.class, () -> service.reorderTasks(template.getId(), null));
        assertEquals(1, a.getSequenceNo());
        verify(tasks, never()).saveAll(anyList());
    }

    @Test
    void ownerRoleMustBeOneOfTheWorkspaceRoles() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("HR_MANAGER"), any())).thenReturn(1);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("IT_TEAM"), any())).thenReturn(0);

        OnboardingTask ok = new OnboardingTask();
        ok.setTitle("Payroll forms");
        ok.setOwnerRole(" HR_MANAGER ");
        assertEquals("HR_MANAGER", service.addTask(template.getId(), ok).getOwnerRole());

        OnboardingTask unknown = new OnboardingTask();
        unknown.setTitle("Badge");
        unknown.setOwnerRole("IT_TEAM");
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> service.addTask(template.getId(), unknown));
        assertEquals("TASK_OWNER_ROLE_UNKNOWN", e.getErrorCode());

        OnboardingTask none = new OnboardingTask();
        none.setTitle("Read the wiki");
        none.setOwnerRole("  ");
        assertNull(service.addTask(template.getId(), none).getOwnerRole());
    }

    @Test
    void taskWithoutPositionGoesToTheEnd() {
        OnboardingTask t = new OnboardingTask();
        t.setTitle("Exit survey");
        t.setSequenceNo(0);
        assertEquals(4, service.addTask(template.getId(), t).getSequenceNo());
    }
}
