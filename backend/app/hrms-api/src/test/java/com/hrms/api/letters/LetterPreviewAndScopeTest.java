package com.hrms.api.letters;

import com.hrms.core.exception.HrmsException;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import com.hrms.letters.domain.LetterTemplate;
import com.hrms.letters.dto.CreateDistributionRequest;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.dto.LetterTemplateDto;
import com.hrms.letters.dto.RecipientFilter;
import com.hrms.letters.repository.DistributionJobRepository;
import com.hrms.letters.repository.DistributionRecipientRepository;
import com.hrms.letters.repository.LetterTemplateRepository;
import com.hrms.letters.service.LetterGenerationService;
import com.hrms.letters.service.LetterTemplateService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * The draft preview (who may be previewed, what is cleaned, the page), the My
 * letters scope on single letters (BW-75), and the BY_BRANCH recipients (BW-72).
 */
class LetterPreviewAndScopeTest {

    private final UUID me = UUID.randomUUID();
    private final LetterTemplateService templates = mock(LetterTemplateService.class);
    private final LetterGenerationService letters = mock(LetterGenerationService.class);

    @BeforeEach void tenant() { TenantContext.setTenantId(UUID.randomUUID()); }
    @AfterEach void clear() { TenantContext.clear(); }

    private Jwt jwt(UUID employeeId, String... permissions) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("permissions", List.of(permissions));
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private LetterTemplateService.RenderedDraft draft(UUID employeeId, boolean sample) {
        return new LetterTemplateService.RenderedDraft("Offer", "<p>Hi</p><script>alert(1)</script>", UUID.randomUUID(),
                "Demo Co", employeeId, employeeId == null ? null : "Asha Rao", sample, List.of());
    }

    // ── who may be previewed ─────────────────────────────────────────────────

    @Test void yourOwnRecordIsTheDefaultSample() {
        when(templates.renderDraft(any(), any(), any(), eq(me), any())).thenReturn(draft(me, false));
        when(letters.withLetterhead(any(), any())).thenAnswer(i -> "<header/>" + i.getArgument(0));
        var out = new LetterPreviewController(templates, letters).preview(
                new LetterPreviewController.PreviewDraftRequest(null, null, "Offer {{employee.fullName}}", "<p>{{employee.code}}</p>", null, LocalDate.of(2026, 3, 9)),
                jwt(me, "hrms.letters.template.create"));
        assertEquals(me, out.employeeId());
        assertFalse(out.sample());
        assertEquals("A4", out.page().size());
        assertEquals(LocalDate.of(2026, 3, 9), out.issueDate());
        assertTrue(out.html().startsWith("<header/>"), "the letterhead goes on top");
        assertFalse(out.html().contains("<script"), "the body is cleaned for display");
    }

    @Test void someoneElseNeedsEmployeeRead() {
        UUID other = UUID.randomUUID();
        var ctrl = new LetterPreviewController(templates, letters);
        var req = new LetterPreviewController.PreviewDraftRequest(null, null, "S", "<p>B</p>", other, null);
        HrmsException e = assertThrows(HrmsException.class, () -> ctrl.preview(req, jwt(me, "hrms.letters.template.read")));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        verify(templates, never()).renderDraft(any(), any(), any(), any(), any());

        when(templates.renderDraft(any(), any(), any(), eq(other), any())).thenReturn(draft(other, false));
        when(letters.withLetterhead(any(), any())).thenAnswer(i -> i.getArgument(0));
        assertEquals(other, ctrl.preview(req, jwt(me, "hrms.letters.template.read", "hrms.employee.read")).employeeId());
    }

    @Test void withNoRecordOfYourOwnTheExamplesAreUsed() {
        when(templates.renderDraft(any(), any(), any(), eq(null), any())).thenReturn(draft(null, true));
        when(letters.withLetterhead(any(), any())).thenAnswer(i -> i.getArgument(0));
        var out = new LetterPreviewController(templates, letters).preview(
                new LetterPreviewController.PreviewDraftRequest(null, null, "S", "<p>B</p>", null, null), jwt(null, "hrms.letters.template.read"));
        assertTrue(out.sample());
        assertNull(out.employeeId());
    }

    @Test void aSavedTemplateIsUsedWhenNoDraftIsGiven() {
        UUID tpl = UUID.randomUUID(), company = UUID.randomUUID();
        when(templates.getTemplate(tpl)).thenReturn(new LetterTemplateDto(tpl, null, company, "Offer", "OFFER", "Saved subject",
                "<p>Saved body</p>", true, null, Instant.now(), Instant.now(), null));
        when(templates.renderDraft(any(), any(), any(), any(), any())).thenReturn(draft(me, false));
        when(letters.withLetterhead(any(), any())).thenAnswer(i -> i.getArgument(0));
        new LetterPreviewController(templates, letters).preview(
                new LetterPreviewController.PreviewDraftRequest(tpl, null, null, null, null, null), jwt(me));
        verify(templates).renderDraft("Saved subject", "<p>Saved body</p>", company, me, null);
    }

    @Test void nothingToPreviewIsSaidPlainly() {
        assertEquals("PREVIEW_EMPTY", assertThrows(HrmsException.class, () -> new LetterPreviewController(templates, letters).preview(
                new LetterPreviewController.PreviewDraftRequest(null, null, null, null, null, null), jwt(me))).getErrorCode());
    }

    @Test void cleaningKeepsFormattingAndDropsAnythingActive() {
        String clean = LetterPreviewController.clean("<h1 style=\"color:red\">Offer</h1><p onclick=\"x()\">Hi <b>Asha</b></p>"
                + "<img src=\"javascript:alert(1)\"><a href=\"https://x.y\">ok</a><iframe src=\"https://x\"></iframe>");
        assertTrue(clean.contains("<h1 style=\"color:red\">Offer</h1>"));
        assertTrue(clean.contains("<b>Asha</b>"));
        assertTrue(clean.contains("href=\"https://x.y\""));
        assertFalse(clean.contains("onclick"));
        assertFalse(clean.contains("javascript"));
        assertFalse(clean.contains("iframe"));
    }

    // ── My letters: a single letter ──────────────────────────────────────────

    @Test void anEmployeeCannotOpenAnUnsentDraftOfTheirs() {
        UUID id = UUID.randomUUID();
        GeneratedLetterDto draft = new GeneratedLetterDto(id, null, null, null, me, "OFFER", "Offer", "GENERATED", true, 1L,
                null, null, null, null, null, null, Map.of(), Instant.now(), Instant.now(), null, null,
                null, null, null, null, null, null, null, null);
        when(letters.getGenerated(id)).thenReturn(draft);
        when(letters.isSentToEmployee(id)).thenReturn(false);
        LetterController ctrl = new LetterController(templates, letters, mock(LetterIssueService.class), mock(LetterExtras.class));
        HrmsException e = assertThrows(HrmsException.class, () -> ctrl.getGenerated(id, jwt(me, "hrms.letters.read.self")));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertThrows(HrmsException.class, () -> ctrl.getPdf(id, jwt(me, "hrms.letters.read.self")));
        verify(letters, never()).getPdf(any());
        verify(letters, never()).markViewedByOwner(any());
    }

    @Test void downloadingYourSentLetterMarksItViewedButHrDownloadingDoesNot() {
        UUID id = UUID.randomUUID();
        GeneratedLetterDto sent = new GeneratedLetterDto(id, null, null, null, me, "OFFER", "Offer", "SENT", true, 1L,
                Instant.now(), "a@b.c", null, null, null, null, Map.of(), Instant.now(), Instant.now(), null, null,
                null, null, null, null, null, null, null, null);
        when(letters.getGenerated(id)).thenReturn(sent);
        when(letters.isSentToEmployee(id)).thenReturn(true);
        when(letters.getPdf(id)).thenReturn(new byte[]{1});
        LetterController ctrl = new LetterController(templates, letters, mock(LetterIssueService.class), mock(LetterExtras.class));
        ctrl.getPdf(id, jwt(UUID.randomUUID(), "hrms.letters.read"));
        verify(letters, never()).markViewedByOwner(any());
        ctrl.getPdf(id, jwt(me, "hrms.letters.read.self"));
        verify(letters).markViewedByOwner(id);
    }

    @Test void theOldTemplatePreviewIsOnlyForPeopleYouMaySee() {
        LetterController ctrl = new LetterController(templates, letters, mock(LetterIssueService.class), mock(LetterExtras.class));
        var req = new com.hrms.letters.dto.PreviewTemplateRequest(UUID.randomUUID(), null);
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(HrmsException.class,
                () -> ctrl.previewTemplate(UUID.randomUUID(), req, jwt(me, "hrms.letters.template.read"))).getStatus());
        when(templates.previewTemplate(any(), eq(req))).thenReturn("<p/>");
        assertEquals(200, ctrl.previewTemplate(UUID.randomUUID(), req, jwt(me, "hrms.letters.template.read", "hrms.employee.read")).getStatusCode().value());
    }

    // ── BY_BRANCH recipients ─────────────────────────────────────────────────

    @Test void recipientsByBranchArePickedAndNeedValidIds() {
        WorkforceEmployeeRepository employees = mock(WorkforceEmployeeRepository.class);
        LetterTemplateRepository templateRepo = mock(LetterTemplateRepository.class);
        when(templateRepo.findActiveById(any())).thenReturn(Optional.of(new LetterTemplate()));
        LetterDistributionService svc = new LetterDistributionService(mock(DistributionJobRepository.class),
                mock(DistributionRecipientRepository.class), templateRepo, employees, mock(LetterDistributionProcessor.class),
                mock(AuditService.class));
        WorkforceEmployee e = new WorkforceEmployee();
        e.setEmail("a@b.c");
        when(employees.findAll(org.mockito.ArgumentMatchers.<Specification<WorkforceEmployee>>any())).thenReturn(List.of(e));
        assertArrayEquals(new int[]{1, 0}, svc.countRecipients(new RecipientFilter(RecipientFilter.BY_BRANCH, List.of(UUID.randomUUID().toString()), null)));

        assertEquals("BAD_FILTER_VALUE", assertThrows(HrmsException.class, () -> svc.countRecipients(
                new RecipientFilter(RecipientFilter.BY_BRANCH, List.of("not-an-id"), null))).getErrorCode());
        assertEquals("NO_RECIPIENTS", assertThrows(HrmsException.class, () -> svc.createDistribution(new CreateDistributionRequest(
                UUID.randomUUID(), "T", null, null, new RecipientFilter(RecipientFilter.BY_BRANCH, List.of(), null)), UUID.randomUUID())).getErrorCode());
    }
}
