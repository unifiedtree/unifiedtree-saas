package com.hrms.api.learning;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.notifications.events.SkillAssessmentDecidedEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Skill self-assessment: validation, who approves, and what an approval changes. */
class SkillAssessmentServiceTest {
    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID(), manager = UUID.randomUUID(), assessment = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TeamEmployeeScope team = mock(TeamEmployeeScope.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final SkillAssessmentService service = new SkillAssessmentService(jdbc, team, events);

    @AfterEach void clear() {
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    private Authentication auth(UUID employeeId, String... permissions) {
        var jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("roles", List.of("DEPT_MANAGER")).claim("employee_id", employeeId.toString()).build();
        List<SimpleGrantedAuthority> authorities = new ArrayList<>();
        for (String p : permissions) authorities.add(new SimpleGrantedAuthority(p));
        return new JwtAuthenticationToken(jwt, authorities);
    }

    private static Employee person(UUID id) {
        Employee e = new Employee();
        e.setId(id);
        return e;
    }

    /** The FOR UPDATE load returns a pending proposal by {@code employee} for TypeScript, level 4. */
    private void pendingProposal() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getObject(1, UUID.class)).thenReturn(employee);
        when(rs.getObject(2, UUID.class)).thenReturn(null);
        when(rs.getString(3)).thenReturn("TypeScript");
        when(rs.getInt(4)).thenReturn(4);
        when(rs.getString(5)).thenReturn("PENDING");
        when(jdbc.query(contains("FOR UPDATE"), org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
    }

    @Test void skillNamesAreTrimmedAndRequired() {
        assertEquals("Spring Boot", SkillAssessmentService.validateSkillName("  Spring   Boot "));
        assertEquals("SKILL_NAME_REQUIRED", assertThrows(BusinessRuleException.class, () -> SkillAssessmentService.validateSkillName("  ")).getErrorCode());
        assertEquals("SKILL_NAME_TOO_LONG", assertThrows(BusinessRuleException.class, () -> SkillAssessmentService.validateSkillName("x".repeat(121))).getErrorCode());
    }

    @Test void levelsRunFromOneToFive() {
        assertEquals(1, SkillAssessmentService.validateLevel(1));
        assertEquals(5, SkillAssessmentService.validateLevel(5));
        for (Integer bad : new Integer[] { null, 0, 6, -1 }) {
            assertThrows(BusinessRuleException.class, () -> SkillAssessmentService.validateLevel(bad));
        }
    }

    @Test void aRejectionNeedsANoteAnApprovalDoesNot() {
        assertEquals("APPROVED", SkillAssessmentService.validateDecision("approved", null));
        assertEquals("REJECTED", SkillAssessmentService.validateDecision("REJECTED", "Needs a project first"));
        assertEquals("DECISION_NOTE_REQUIRED", assertThrows(BusinessRuleException.class,
                () -> SkillAssessmentService.validateDecision("REJECTED", "  ")).getErrorCode());
        assertEquals("INVALID_DECISION", assertThrows(BusinessRuleException.class,
                () -> SkillAssessmentService.validateDecision("MAYBE", "x")).getErrorCode());
    }

    @Test void theApproverIsTheDepartmentHeadElseAManagerWhoHeadsNoDepartment() {
        UUID head = UUID.randomUUID(), rm = UUID.randomUUID();
        assertEquals(head, SkillAssessmentService.pickApprover(employee, head, rm, 0));
        assertEquals(rm, SkillAssessmentService.pickApprover(employee, null, rm, 0));
        assertNull(SkillAssessmentService.pickApprover(employee, null, rm, 1), "heads another department: not their team");
        assertEquals(rm, SkillAssessmentService.pickApprover(employee, employee, rm, 0), "a head is not their own approver");
        assertNull(SkillAssessmentService.pickApprover(employee, employee, null, 0), "falls back to HR");
    }

    @Test void nobodyDecidesTheirOwnProposal() throws Exception {
        pendingProposal();
        var req = new SkillAssessmentService.DecideRequest("APPROVED", null);
        assertThrows(AccessDeniedException.class, () -> service.decide(tenant, assessment, req,
                auth(employee, "hrms.learning.skill.approve", "hrms.learning.write"), UUID.randomUUID()));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(events);
    }

    @Test void aManagerCannotDecideForSomeoneOutsideTheirTeam() throws Exception {
        pendingProposal();
        Authentication mgr = auth(manager, "hrms.learning.skill.approve");
        when(team.resolve(any(Jwt.class), isNull())).thenReturn(List.of(person(UUID.randomUUID())));
        assertThrows(AccessDeniedException.class, () -> service.decide(tenant, assessment,
                new SkillAssessmentService.DecideRequest("APPROVED", null), mgr, UUID.randomUUID()));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void approvingUpdatesTheSkillMatrixAndTellsTheEmployee() throws Exception {
        pendingProposal();
        UUID existingSkill = UUID.randomUUID();
        ResultSet skillRow = mock(ResultSet.class);
        when(skillRow.next()).thenReturn(true);
        when(skillRow.getObject(1, UUID.class)).thenReturn(existingSkill);
        when(jdbc.query(contains("SELECT id FROM learning_mgmt.employee_skills"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(skillRow));
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        var dto = new SkillAssessmentService.AssessmentDto(assessment, employee, "Reader User", "E-2", null,
                existingSkill, "TypeScript", 3, 4, null, "APPROVED", "Dept Manager", null, null, null);
        when(jdbc.query(contains("FROM learning_mgmt.skill_assessments a"), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(dto));
        when(team.resolve(any(Jwt.class), isNull())).thenReturn(List.of(person(employee)));

        var result = service.decide(tenant, assessment, new SkillAssessmentService.DecideRequest("APPROVED", "Agreed"),
                auth(manager, "hrms.learning.skill.approve"), UUID.randomUUID());

        assertEquals("APPROVED", result.status());
        verify(jdbc).update(contains("UPDATE learning_mgmt.employee_skills"), eq(4), any(), eq(tenant), eq(existingSkill));
        verify(jdbc).update(contains("UPDATE learning_mgmt.skill_assessments"), eq("APPROVED"), eq(existingSkill),
                eq(manager), any(), eq("Agreed"), any(), eq(tenant), eq(assessment));
        verify(events).publishEvent(argThat((Object e) -> e instanceof SkillAssessmentDecidedEvent d
                && d.approved() && d.employeeId().equals(employee) && d.proposedLevel() == 4));
    }

    @Test void proposingTheLevelAlreadyRecordedIsRefused() throws Exception {
        when(jdbc.queryForObject(contains("FROM hrms.employees"), eq(Integer.class), any(Object[].class))).thenReturn(1);
        ResultSet current = mock(ResultSet.class);
        when(current.next()).thenReturn(true);
        when(current.getObject(1, UUID.class)).thenReturn(UUID.randomUUID());
        when(current.getInt(2)).thenReturn(3);
        when(jdbc.query(contains("SELECT id, proficiency FROM learning_mgmt.employee_skills"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(current));
        var err = assertThrows(BusinessRuleException.class, () -> service.propose(tenant, employee,
                new SkillAssessmentService.ProposeRequest("TypeScript", 3, null), UUID.randomUUID()));
        assertEquals("SKILL_LEVEL_UNCHANGED", err.getErrorCode());
        verify(jdbc, never()).queryForObject(contains("INSERT INTO learning_mgmt.skill_assessments"), eq(UUID.class), any(Object[].class));
        verifyNoInteractions(events);
    }

    @Test void hrSeesEveryoneAManagerOnlyTheirTeam() {
        assertNull(service.approverScope(auth(manager, "hrms.learning.skill.approve", "hrms.learning.write")));
        when(team.resolve(any(Jwt.class), isNull())).thenReturn(List.of(person(employee)));
        assertEquals(java.util.Set.of(employee), service.approverScope(auth(manager, "hrms.learning.skill.approve")));
        when(team.resolve(any(Jwt.class), isNull())).thenThrow(new IllegalArgumentException("no employee"));
        assertTrue(service.approverScope(auth(manager, "hrms.learning.skill.approve")).isEmpty());
    }
}
