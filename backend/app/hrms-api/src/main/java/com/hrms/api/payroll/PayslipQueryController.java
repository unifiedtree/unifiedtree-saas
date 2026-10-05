package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * "Ask payroll" (BW-59, V143.58).
 * <ul>
 *   <li>Employee: {@code GET /v1/payroll/payslips/me/queries[?runId]} and
 *       {@code POST /v1/payroll/payslips/me/{runId}/queries}
 *       ({@code payroll.payslip.read.self}; own LOCKED or PAID payslips only,
 *       the person taken from the token).</li>
 *   <li>Payroll team and HR: {@code GET /v1/payroll/queries[?status&limit]} and
 *       {@code POST /v1/payroll/queries/{id}/answer}
 *       ({@code payroll.runs.manage}, or since V143.86 the narrower
 *       {@code payroll.queries.answer}, which reaches only this queue and never
 *       a payroll run; read from the database so a new grant works without
 *       signing in again).</li>
 * </ul>
 * The literal {@code /payslips/me/queries} is more specific than
 * {@code /payslips/me/{runId}}, so it is never taken for a run id.
 */
@RestController
@RequestMapping("/v1/payroll")
public class PayslipQueryController {

    /** Reading and answering the queue: the payroll team, or anyone given only payroll.queries.answer. */
    static final String ANSWER_GUARD = "@perm.hasAny('payroll.runs.manage','payroll.queries.answer')";

    private final PayslipQueryService service;

    public PayslipQueryController(PayslipQueryService service) {
        this.service = service;
    }

    public record AskRequest(@NotBlank @Size(max = PayslipQueryService.MAX_MESSAGE) String message) {}

    public record AnswerRequest(@NotBlank @Size(max = PayslipQueryService.MAX_ANSWER) String answer) {}

    @GetMapping("/payslips/me/queries")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public List<PayslipQueryService.PayslipQueryDto> mine(@RequestParam(required = false) UUID runId,
                                                          @AuthenticationPrincipal Jwt jwt) {
        return service.mine(TenantContext.getTenantId(), MyPayController.ownEmployeeId(jwt), runId);
    }

    @PostMapping("/payslips/me/{runId}/queries")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public PayslipQueryService.PayslipQueryDto ask(@PathVariable UUID runId, @Valid @RequestBody AskRequest req,
                                                   @AuthenticationPrincipal Jwt jwt) {
        return service.raise(TenantContext.getTenantId(), TenantContext.getUserId(),
                MyPayController.ownEmployeeId(jwt), runId, req.message());
    }

    @GetMapping("/queries")
    @PreAuthorize(ANSWER_GUARD)
    public List<PayslipQueryService.PayslipQueryDto> list(@RequestParam(required = false) String status,
                                                          @RequestParam(required = false) Integer limit) {
        return service.list(TenantContext.getTenantId(), status, limit);
    }

    @PostMapping("/queries/{id}/answer")
    @PreAuthorize(ANSWER_GUARD)
    public PayslipQueryService.PayslipQueryDto answer(@PathVariable UUID id, @Valid @RequestBody AnswerRequest req,
                                                      @AuthenticationPrincipal Jwt jwt) {
        return service.answer(TenantContext.getTenantId(), TenantContext.getUserId(),
                MyPayController.ownEmployeeId(jwt), id, req.answer());
    }
}
